// Vercel serverless function — บอทอ่านสลิปในไลน์แล้วสรุปตอบกลับในกลุ่ม
// GET = health check, POST = event จาก LINE
import { verifySignature, getImageContent, replyMessage } from '../lib/line.js';
import { readSlip } from '../lib/vision.js';

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
  // สนใจเฉพาะรูปภาพ (สลิป)
  if (event.type !== 'message' || event.message?.type !== 'image') return;

  const { buffer, contentType } = await getImageContent(event.message.id, env.token);
  const slip = await readSlip(buffer, contentType, { apiKey: env.apiKey, model: env.model });
  const text = formatReply(slip);
  if (event.replyToken) await replyMessage(event.replyToken, text, env.token);
  console.log('อ่านสลิป:', slip?.amount ?? 'อ่านไม่ออก');
}

function formatReply(slip) {
  if (!slip || slip.amount == null || slip.success === false) {
    return '⚠️ อ่านสลิปไม่ออก รบกวนส่งรูปที่ชัดขึ้นอีกครั้งนะครับ';
  }
  const lines = ['✅ อ่านสลิปแล้ว', `💰 จำนวนเงิน: ${fmtBaht(slip.amount)} บาท`];
  if (slip.datetime) lines.push(`🕒 เวลา: ${slip.datetime}`);
  if (slip.sender) lines.push(`➡️ ผู้โอน: ${slip.sender}`);
  if (slip.receiver) lines.push(`⬅️ ผู้รับ: ${slip.receiver}`);
  if (slip.ref) lines.push(`#️⃣ อ้างอิง: ${slip.ref}`);
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
