// Vercel serverless function — จุดรับ webhook จาก LINE
// GET = health check, POST = event จาก LINE
import { verifySignature, getImageContent, getGroupMemberName } from '../lib/line.js';
import { readSlip } from '../lib/vision.js';
import { isReport, parseReport } from '../lib/parse.js';
import { reconcile } from '../lib/reconcile.js';
import {
  ensureSetup, appendPending, getUnconsumedPending, markConsumed, appendMainRow,
} from '../lib/sheets.js';

// อย่าให้ Vercel แกะ body — เราต้องใช้ raw body ตรวจ signature
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('store-cash-bot ok');
  }

  const env = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    token: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
    allowedGroupId: process.env.ALLOWED_GROUP_ID || '',
    windowMin: parseInt(process.env.PENDING_WINDOW_MIN || '45', 10),
  };

  let raw;
  try {
    raw = await getRawBody(req);
  } catch (e) {
    console.error('read body error', e);
    return res.status(200).end(); // 200 กัน LINE retry ถล่ม
  }

  const signature = req.headers['x-line-signature'];
  if (!verifySignature(env.channelSecret, raw, signature)) {
    console.warn('signature ไม่ผ่าน');
    return res.status(401).send('bad signature');
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(200).end();
  }

  const events = body.events || [];
  try {
    await ensureSetup();
  } catch (e) {
    console.error('ensureSetup error', e);
  }

  for (const event of events) {
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
  const src = event.source || {};
  const groupId = src.groupId || '';
  const userId = src.userId || '';
  // ครั้งแรกยังไม่ตั้ง ALLOWED_GROUP_ID → log groupId ออกมาให้เอาไปตั้งค่า
  if (!env.allowedGroupId) console.log('groupId (เอาค่านี้ไปใส่ ALLOWED_GROUP_ID):', groupId);
  if (env.allowedGroupId && groupId !== env.allowedGroupId) return; // จำกัดเฉพาะกลุ่มร้าน

  const msg = event.message;

  // 1) รูปสลิป → อ่านยอด → เก็บเข้าคิวรอจับคู่
  if (msg.type === 'image') {
    const { buffer, contentType } = await getImageContent(msg.id, env.token);
    const slip = await readSlip(buffer, contentType, { apiKey: env.apiKey, model: env.model });
    if (slip.amount != null && slip.success) {
      await appendPending({
        epochMs: event.timestamp,
        userId, groupId,
        amount: slip.amount,
        messageId: msg.id,
        datetime: slip.datetime,
        sender: slip.sender,
        ref: slip.ref,
      });
      console.log(`สลิป ${msg.id}: ${slip.amount} บาท → เข้าคิว`);
    } else {
      console.warn(`สลิป ${msg.id}: อ่านยอดไม่ได้`, slip.raw?.slice(0, 120));
    }
    return;
  }

  // 2) ข้อความ #ตรวจเงิน → รวมสลิป → คำนวณ → บันทึก
  if (msg.type === 'text' && isReport(msg.text)) {
    const parsed = parseReport(msg.text);
    if (!parsed.ok) {
      console.warn('parse ใบตรวจเงินไม่ผ่าน:', parsed.errors.join('; '));
      return;
    }
    const { branch, shift, cash, pos } = parsed.data;
    const name = groupId ? await getGroupMemberName(groupId, userId, env.token) : userId;

    const sinceMs = event.timestamp - env.windowMin * 60 * 1000;
    const pend = await getUnconsumedPending(userId, groupId, sinceMs);
    const transfer = pend.reduce((s, p) => s + p.amount, 0);

    const { received, diff, status } = reconcile(cash, transfer, pos);
    const dateStr = formatBangkokDate(event.timestamp);
    const stampStr = formatBangkokDateTime(event.timestamp);

    await appendMainRow([
      dateStr, branch, shift, name, pos, cash,
      transfer, received, diff, status, pend.length, '', stampStr,
    ]);
    await markConsumed(pend.map((p) => p.rowNumber));
    console.log(`บันทึก ${branch}/${shift}: รับจริง ${received} vs POS ${pos} → ${status} (${pend.length} สลิป)`);
  }
}

// ---- อ่าน raw body จาก stream ----
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ---- วันที่/เวลา โซนไทย (UTC+7) โดยไม่พึ่งไลบรารี ----
function bangkok(ts) {
  return new Date(ts + 7 * 60 * 60 * 1000);
}
function formatBangkokDate(ts) {
  const d = bangkok(ts);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}
function formatBangkokDateTime(ts) {
  const d = bangkok(ts);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatBangkokDate(ts)} ${hh}:${mi}`;
}
