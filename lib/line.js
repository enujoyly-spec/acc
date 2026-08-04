// เชื่อมกับ LINE Messaging API: ตรวจ signature, ดึงรูปสลิป, ดึงชื่อผู้ส่ง
import crypto from 'crypto';

const API = 'https://api.line.me';
const DATA_API = 'https://api-data.line.me';

/** ตรวจว่า webhook มาจาก LINE จริง (HMAC-SHA256 ของ raw body ด้วย channel secret) */
export function verifySignature(channelSecret, rawBody, signature) {
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', channelSecret)
    .update(rawBody)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** ดึงเนื้อรูป (binary) ของ image message → Buffer */
export async function getImageContent(messageId, accessToken) {
  const res = await fetch(`${DATA_API}/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`LINE content ${messageId} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { buffer: buf, contentType };
}

/** ชื่อที่แสดงของผู้ส่งในกลุ่ม (ใช้เป็นชื่อพนักงาน) — คืน userId ถ้าดึงไม่ได้ */
export async function getGroupMemberName(groupId, userId, accessToken) {
  try {
    const res = await fetch(`${API}/v2/bot/group/${groupId}/member/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return userId;
    const data = await res.json();
    return data.displayName || userId;
  } catch {
    return userId;
  }
}

/** ตอบกลับข้อความ (ใช้ replyToken ภายในไม่กี่วินาทีหลังรับ event) */
export async function replyMessage(replyToken, text, accessToken) {
  // รับได้ทั้งข้อความล้วน, message object เดียว, และ array (สูงสุด 5 ต่อการตอบ 1 ครั้ง)
  const messages = (Array.isArray(text) ? text : [text])
    .filter(Boolean)
    .slice(0, 5)
    .map((m) => (typeof m === 'string' ? { type: 'text', text: m } : m));
  if (!messages.length) return;
  const res = await fetch(`${API}/v2/bot/message/reply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('reply failed', res.status, t);
  }
}

/** ส่งข้อความเข้ากลุ่ม/แชทโดยตรง (ใช้กับแจ้งเตือนอัตโนมัติจาก cron) */
export async function pushMessage(to, text, accessToken) {
  const res = await fetch(`${API}/v2/bot/message/push`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LINE push HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
}
