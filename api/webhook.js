// Vercel serverless function — บอทอ่านรูปรายงาน/สลิปในกลุ่มไลน์ ตอบสรุป + เก็บสะสมทำสรุปรายวัน
// GET = health check, POST = event จาก LINE
import { verifySignature, getImageContent, replyMessage } from '../lib/line.js';
import { readReport } from '../lib/vision.js';
import { storeReady, appendReport, loadDay, saveGroupId } from '../lib/store.js';
import { fmtBaht, bangkokParts, buildDailySummary } from '../lib/summary.js';

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
      await processEvent(event, env);
    } catch (e) {
      console.error('process event error', e);
    }
  }
  return res.status(200).end();
}

async function processEvent(event, env) {
  if (event.type !== 'message') return;
  const groupId = event.source?.groupId || null;

  // ---- ข้อความ "สรุป" → สรุป 2 ช่วงเวลา + ทั้งวัน ----
  if (event.message?.type === 'text' && /สรุป/.test(event.message.text || '')) {
    const { dateKey, dateLabel } = bangkokParts(event.timestamp);
    let text;
    if (!storeReady()) {
      text = '⚠️ ยังไม่ได้เปิดที่เก็บข้อมูล (Vercel Blob) จึงสรุปรายวันไม่ได้ — เปิดที่ Vercel: Storage → Blob → Connect Project';
    } else {
      const records = await loadDay(dateKey);
      text = buildDailySummary(records, dateLabel);
    }
    if (event.replyToken) await replyMessage(event.replyToken, text, env.token);
    return;
  }

  // ---- รูปภาพ (รายงานปิดกะ/สลิป) ----
  if (event.message?.type !== 'image') return;

  const { buffer, contentType } = await getImageContent(event.message.id, env.token);
  const report = await readReport(buffer, contentType, { apiKey: env.apiKey, model: env.model });

  // เก็บสะสมไว้ทำสรุปรายวัน + จำกลุ่มปลายทางไว้แจ้งเตือนอัตโนมัติ (ถ้าเปิด Blob แล้ว)
  if (report?.success && storeReady()) {
    try {
      const { dateKey, hhmm } = bangkokParts(event.timestamp);
      await appendReport(dateKey, {
        time: hhmm,
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

  const text = formatReply(report);
  if (event.replyToken) await replyMessage(event.replyToken, text, env.token);
  console.log('อ่านรายงาน:', JSON.stringify({
    cashSales: report?.cashSales, deposit: report?.deposit, success: report?.success,
  }));
}

function formatReply(r) {
  if (!r || r.success === false) {
    return '⚠️ อ่านรูปไม่ออก รบกวนส่งรูปที่ชัดขึ้นอีกครั้งนะครับ';
  }
  const lines = ['📋 สรุปรายงานปิดกะ'];
  if (r.docNo) lines.push(`📄 เลขที่: ${r.docNo}`);
  if (r.date) lines.push(`🗓️ วันที่: ${r.date}`);
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
