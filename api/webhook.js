// Vercel serverless function — บอทอ่านรูปรายงาน/สลิปในกลุ่มไลน์ ตอบสรุป + เก็บสะสมทำสรุปรายวัน
// GET = health check, POST = event จาก LINE
import { verifySignature, getImageContent, replyMessage } from '../lib/line.js';
import { readReport } from '../lib/vision.js';
import { storeReady, appendReport, loadDay, saveGroupId } from '../lib/store.js';
import { fmtBaht, bangkokParts, buildDailySummary, normalizeThaiDate } from '../lib/summary.js';
import {
  loadSnapshot, loadOrders, addOrder, removeOrder, routeText, answer, todayBangkok,
  notice, orderAck,
} from '../lib/mangmee.js';
import { ask } from '../lib/ask.js';
import { staleNote } from '../lib/flex.js';

// อย่าให้ Vercel แกะ body — เราต้องใช้ raw body ตรวจ signature
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('slip-reader-bot ok');
  }

  const env = {
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    token: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    apiKey: process.env.OPENROUTER_API_KEY,
    // กำหนดในโค้ดตรงๆ (ทับ env เดิมที่เป็น gpt-4o-mini) — Gemini 2.5 Flash อ่านเอกสาร/ลายมือไทยแม่นกว่า
    model: 'google/gemini-2.5-flash',
  };

  let raw;
  try {
    raw = await getRawBody(req);
  } catch (e) {
    console.error('read body error', e);
    return res.status(200).end();
  }

  // ตรวจ signature เฉพาะเมื่อมีการตั้ง channel secret (ไม่ตั้งก็ข้าม)
  if (env.channelSecret) {
    const signature = req.headers['x-line-signature'];
    if (!verifySignature(env.channelSecret, raw, signature)) {
      console.warn('signature ไม่ผ่าน');
      return res.status(401).send('bad signature');
    }
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(200).end();
  }

  for (const event of body.events || []) {
    try {
      await processEvent(event, { ...env, req });
    } catch (e) {
      console.error('process event error', e);
    }
  }
  return res.status(200).end();
}

/**
 * ข้อความนี้เป็นคำสั่งสรุปเงินนำส่ง (บอทอ่านสลิป) หรือเปล่า
 *
 * เดิมเช็คแค่ว่ามีคำว่า "สรุป" อยู่ที่ไหนก็ได้ ทำให้ "ขอสรุปสินค้าขายดี"
 * ถูกดักไปตอบสรุปเงินนำส่งแทนที่จะเป็นยอดขายรายสินค้า
 * จึงบังคับให้ขึ้นต้นด้วย "สรุป" และตามด้วยได้แค่ เมื่อวาน/วันนี้/วันที่ เท่านั้น
 */
function isSlipSummary(text) {
  const t = (text || '').trim();
  return /^สรุป\s*(เมื่อวาน|วันนี้|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})?$/.test(t);
}

async function processEvent(event, env) {
  if (event.type !== 'message') return;
  const groupId = event.source?.groupId || null;

  // ---- คุยเรื่องยอดขาย/เงินสด/สั่งของ (ข้อมูลจาก mangmee) ----
  if (event.message?.type === 'text' && !isSlipSummary(event.message.text)) {
    // ข้อความสั้นๆ ที่ตรงคำสั่งประจำ ใช้คำสำคัญจับ (เร็ว แม่น ไม่เสียโทเคน)
    // ประโยคยาวมักเป็นคำถามที่ซับซ้อนกว่านั้น เช่น "ยอดเมื่อวานกับวันนี้ต่างกันเท่าไหร่"
    // ถ้าเอาไปเข้าคำสั่งประจำจะตอบไม่ตรงคำถาม จึงโยนให้ AI แทน
    const raw = (event.message.text || '').trim();
    const route = (raw.length <= 30 && routeText(raw)) || { kind: 'ask', text: raw };
    const msgs = await handleMangmee(route, env);
    if (msgs?.length) {
      if (event.replyToken) await replyMessage(event.replyToken, msgs, env.token);
      return;
    }
  }

  // ---- ข้อความ "สรุป" → สรุปวันนี้ / "สรุปเมื่อวาน" / "สรุป 23/07/2569" ----
  if (event.message?.type === 'text' && isSlipSummary(event.message.text)) {
    const txt = event.message.text || '';
    let { dateKey, dateLabel } = bangkokParts(event.timestamp);
    const dm = txt.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/);
    if (dm) {
      const k = normalizeThaiDate(dm[1]);
      if (k) {
        dateKey = k;
        const [y, m, d] = k.split('-');
        dateLabel = `${d}/${m}/${y}`;
      }
    } else if (/เมื่อวาน/.test(txt)) {
      ({ dateKey, dateLabel } = bangkokParts(event.timestamp - 86400000));
    }
    let msgs;
    if (!storeReady()) {
      msgs = notice('สรุปรายวันไม่ได้', 'ยังไม่ได้เปิดที่เก็บข้อมูล', [
        'ยังไม่ได้เปิด Vercel Blob',
        'เปิดที่ Vercel: Storage → Blob → Connect Project',
      ], { hot: true });
    } else {
      const records = await loadDay(dateKey);
      msgs = notice('สรุปเงินนำส่ง', dateLabel,
                    buildDailySummary(records, dateLabel).split('\n'));
    }
    if (event.replyToken) await replyMessage(event.replyToken, msgs, env.token);
    return;
  }

  // ---- รูปภาพ (รายงานปิดกะ/สลิป) ----
  if (event.message?.type !== 'image') return;

  const { buffer, contentType } = await getImageContent(event.message.id, env.token);
  const report = await readReport(buffer, contentType, { apiKey: env.apiKey, model: env.model });
  const { dateKey, hhmm } = bangkokParts(event.timestamp);

  // ส่งย้อนหลังได้: ถ้าอ่านวันที่ในเอกสารออก ให้เก็บเข้าวันนั้นแทนวันที่ส่ง
  const docKey = normalizeThaiDate(report?.date);
  const storeKey = docKey || dateKey;
  const backdated = Boolean(docKey && docKey !== dateKey);
  // ช่วงเช้า/บ่ายให้ยึดเวลาตามเอกสารก่อน (ถ้ามี) — เวลาส่งใช้เป็นตัวสำรอง
  const docTimeOk = /^\d{1,2}:\d{2}/.test(report?.docTime || '');
  const storeTime = docTimeOk ? report.docTime.slice(0, 5).padStart(5, '0') : hhmm;

  // เก็บสะสมไว้ทำสรุปรายวัน + จำกลุ่มปลายทางไว้แจ้งเตือนอัตโนมัติ (ถ้าเปิด Blob แล้ว)
  if (report?.success && storeReady()) {
    try {
      await appendReport(storeKey, {
        time: storeTime,
        sentAt: `${dateKey} ${hhmm}`,   // เวลาที่ส่งจริง (ไว้ตรวจย้อนหลัง)
        docDate: report.date,           // วันที่ตามเอกสาร (ตามที่อ่านได้)
        docTime: report.docTime,        // เวลาตามเอกสาร
        cashSales: report.cashSales,
        transferSales: report.transferSales,
        epayment: report.epayment,
        total: report.total,
        deposit: report.deposit,
        slipsTotal: report.slipsTotal,
      });
      if (groupId) await saveGroupId(groupId);
    } catch (e) {
      console.error('store error', e);
    }
  }

  const text = formatReply(report, dateKey, hhmm, backdated);
  if (event.replyToken) {
    await replyMessage(event.replyToken,
      notice(report?.success ? 'อ่านรายงานแล้ว' : 'อ่านรูปไม่ออก',
             backdated ? `ลงวันที่ ${report?.date}` : dateKey,
             text.split('\n'), { hot: !report?.success }),
      env.token);
  }
  console.log('อ่านรายงาน:', JSON.stringify({
    docDate: report?.date, cashSales: report?.cashSales, deposit: report?.deposit, success: report?.success,
  }));
}

// ตอบคำถามเรื่องยอด/เงินสด/ของที่ต้องสั่ง และจำว่าอะไรสั่งไปแล้ว
// ห่อ try/catch ไว้ชั้นนอก — ถ้าพังแล้วเงียบ ผู้ใช้จะนึกว่าบอทตายไปเฉยๆ
async function handleMangmee(route, env) {
  try {
    return await mangmeeReply(route, env);
  } catch (e) {
    console.error('mangmee reply error', e);
    return notice('ตอบไม่ได้ตอนนี้', 'ระบบขัดข้องชั่วคราว', [
      `เกิดข้อผิดพลาด (${e?.name || 'error'})`,
      'ลองพิมพ์ใหม่อีกครั้ง',
      'หรือพิมพ์ "ช่วย" เพื่อดูคำสั่งที่ใช้ได้',
    ], { hot: true });
  }
}

async function mangmeeReply(route, env) {
  const dateKey = todayBangkok();

  if (route.kind === 'order-add' || route.kind === 'order-del') {
    const fn = route.kind === 'order-add' ? addOrder : removeOrder;
    const items = await fn(dateKey, route.name);
    if (items === null) {
      return notice('จำรายการไม่ได้', 'ยังไม่ได้เปิดที่เก็บข้อมูล', [
        'ยังไม่ได้เปิด Vercel Blob จึงจำรายการที่สั่งแล้วไม่ได้',
        'เปิดที่ Vercel: Storage → Blob → Connect Project',
      ], { hot: true });
    }
    let left = null;
    try {
      const snap = await loadSnapshot(env.req);
      left = snap.order.filter(
        (o) => !items.some((n) => o.name.toLowerCase().includes(n.toLowerCase()))).length;
    } catch { /* ไม่มี snapshot ก็ยังจำได้ */ }
    return orderAck(route.name, route.kind === 'order-add', items, left);
  }

  let snap;
  try {
    snap = await loadSnapshot(env.req);
  } catch {
    return notice('ยังไม่มีข้อมูลสรุป', 'รอ build จากเครื่องร้าน', [
      'ยังไม่มีไฟล์สรุปยอดบนเซิร์ฟเวอร์',
      'ต้องรัน mangmee.py web ที่เครื่องร้านแล้ว publish ขึ้นมาก่อน',
    ], { hot: true });
  }
  const orders = await loadOrders(dateKey);

  // ถามอะไรก็ได้ที่คำสำคัญจับไม่ได้ → ให้ AI ตอบจาก snapshot
  if (route.kind === 'ask') {
    const r = await ask(route.text, snap, orders, { apiKey: env.apiKey, model: env.model });
    if (r.action) {                     // AI ตีความว่ากำลังบอกว่าสั่งของแล้ว
      return mangmeeReply({ kind: r.action, name: r.name }, env);
    }
    if (!r.reply) {
      return notice('ยังตอบไม่ได้', 'ลองถามใหม่อีกแบบ', [
        'ผมยังไม่เข้าใจคำถามนี้ครับ',
        'พิมพ์ "ช่วย" เพื่อดูตัวอย่างคำถามที่ตอบได้',
      ], { hot: true });
    }
    return notice('ตอบคำถาม', `${snap.dayLabel} · ${snap.shop}`, r.reply.split('\n'));
  }

  const msgs = answer(route.kind, snap, orders);
  if (!msgs?.length) return null;

  // ข้อมูลมาจาก snapshot ที่ build ไว้ ถ้าไม่ใช่ของวันนี้ต้องบอกให้รู้ ไม่งั้นเข้าใจผิด
  // ตอนนี้คำตอบเป็นกล่องทั้งหมด จึงต้องเติมบรรทัดเข้าไปในกล่อง ไม่ใช่ต่อท้ายข้อความ
  const box = msgs[0]?.contents?.body?.contents;
  if (snap.day !== dateKey && Array.isArray(box)) {
    box.push(staleNote(`ข้อมูลล่าสุดถึง ${snap.dayLabel} · อัปเดต ${snap.generated}`));
  }
  return msgs;
}

function formatReply(r, todayKey, receivedHHMM, backdated) {
  if (!r || r.success === false) {
    return '⚠️ อ่านรูปไม่ออก รบกวนส่งรูปที่ชัดขึ้นอีกครั้งนะครับ';
  }
  const lines = ['📋 สรุปรายงานปิดกะ'];
  if (r.docNo) lines.push(`📄 เลขที่: ${r.docNo}`);
  if (r.date) {
    const t = r.docTime ? ` ${r.docTime} น.` : '';
    lines.push(`🗓️ วันที่ตามเอกสาร: ${r.date}${t}`);
    if (backdated) {
      lines.push(`📥 บันทึกย้อนหลังเข้าวันที่ ${r.date} ให้แล้ว (ส่งเมื่อ ${receivedHHMM} น.)`);
    }
  } else {
    lines.push('🗓️ วันที่ตามเอกสาร: อ่านไม่ชัด ⚠️ (บันทึกเข้าวันที่ส่งแทน)');
  }
  if (r.cashSales != null) lines.push(`🧾 ยอดขายเงินสด: ${fmtBaht(r.cashSales)} บาท`);
  if (r.transferSales != null) lines.push(`🏦 ยอดขายโอน: ${fmtBaht(r.transferSales)} บาท`);
  if (r.epayment != null) lines.push(`📱 E-Payment: ${fmtBaht(r.epayment)} บาท`);
  if (r.total != null) lines.push(`🧮 ยอดรวม: ${fmtBaht(r.total)} บาท`);
  if (r.deposit != null) lines.push(`💵 นำส่งจริง: ${fmtBaht(r.deposit)} บาท`);

  // สลิปหลายใบ: แจกแจงรายใบ + ยอดรวมที่ระบบบวกเอง
  if (r.slips?.length) {
    lines.push(`🧾 สลิปที่พบ ${r.slips.length} ใบ:`);
    r.slips.forEach((s, i) => {
      const t = s.time ? ` (${s.time})` : '';
      const flag = s.suspicious ? ' ⚠️' : '';
      lines.push(`   ${i + 1}) ${fmtBaht(s.amount)} บาท${t}${flag}`);
    });
    lines.push(`   ➕ รวมสลิป: ${fmtBaht(r.slipsTotal)} บาท`);
  }

  // เทียบยอด: ใช้ยอดนำส่งจากรายงาน ถ้าไม่มีใช้ยอดรวมสลิปแทน
  const actual = r.deposit ?? r.slipsTotal;
  if (r.cashSales != null && actual != null) {
    const diff = actual - r.cashSales;
    if (Math.abs(diff) < 0.005) lines.push('✅ พอดี (ไม่ขาดไม่เกิน)');
    else if (diff > 0) lines.push(`🔺 เกิน: ${fmtBaht(diff)} บาท`);
    else lines.push(`🔻 ขาด: ${fmtBaht(Math.abs(diff))} บาท`);
  }
  // ถ้ามีทั้งยอดนำส่งในรายงานและสลิป ให้เช็คไขว้กันด้วย
  if (r.deposit != null && r.slipsTotal != null && Math.abs(r.deposit - r.slipsTotal) >= 0.005) {
    lines.push(`⚠️ ยอดสลิปรวม (${fmtBaht(r.slipsTotal)}) ไม่ตรงกับยอดนำส่งในรายงาน (${fmtBaht(r.deposit)})`);
  }

  if (r.note) lines.push(`✍️ โน้ต: ${r.note}`);
  if (r.suspicious?.length) {
    lines.push(`⚠️ ตัวเลขน่าสงสัย (อาจอ่านทศนิยมพลาด): ${r.suspicious.join(', ')} — กรุณาตรวจกับรูปจริงอีกครั้ง`);
  }
  return lines.join('\n');
}

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
