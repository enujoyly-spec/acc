// Vercel serverless function — บอทอ่านสลิปในไลน์แล้วสรุปตอบกลับในกลุ่ม
// GET = health check, POST = event จาก LINE
import { verifySignature, getImageContent, replyMessage } from '../lib/line.js';
import { readReport } from '../lib/vision.js';

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
    model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
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
  // สนใจเฉพาะรูปภาพ (รายงานปิดกะ)
  if (event.type !== 'message' || event.message?.type !== 'image') return;

  const { buffer, contentType } = await getImageContent(event.message.id, env.token);
  const report = await readReport(buffer, contentType, { apiKey: env.apiKey, model: env.model });
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

function fmtBaht(n) {
  return Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
