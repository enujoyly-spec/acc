// แจ้งเตือนสรุปอัตโนมัติเข้ากลุ่มไลน์ — ถูกเรียกโดย Vercel Cron (ดู vercel.json)
// 12:05 น. ไทย = สรุปช่วงเช้า, 23:55 น. ไทย = สรุปทั้งวัน
import { pushMessage } from '../lib/line.js';
import { storeReady, loadDay, loadGroupId } from '../lib/store.js';
import { bangkokParts, buildDailySummary } from '../lib/summary.js';

export default async function handler(req, res) {
  // อนุญาตเฉพาะ Vercel Cron (หรือทดสอบเองด้วย ?key= ที่ตรงกับ CRON_SECRET)
  const ua = req.headers['user-agent'] || '';
  const isCron = ua.includes('vercel-cron') || req.headers['x-vercel-cron'];
  const keyOk = process.env.CRON_SECRET && req.query?.key === process.env.CRON_SECRET;
  if (!isCron && !keyOk) {
    return res.status(401).send('unauthorized');
  }

  if (!storeReady()) {
    return res.status(200).send('blob not configured');
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = await loadGroupId();
  if (!groupId) {
    return res.status(200).send('no group id yet (ส่งรูปในกลุ่มก่อน 1 ครั้ง บอทจะจำกลุ่มเอง)');
  }

  const { dateKey, dateLabel, hhmm } = bangkokParts(Date.now());
  const records = await loadDay(dateKey);

  const isMidday = hhmm < '18:00'; // รอบ 12:05 = สรุปครึ่งวัน, รอบ 23:55 = สรุปทั้งวัน
  const header = isMidday
    ? '🔔 แจ้งเตือนอัตโนมัติ (รอบเที่ยง)'
    : '🔔 แจ้งเตือนอัตโนมัติ (รอบปิดวัน)';
  const text = `${header}\n${buildDailySummary(records, dateLabel)}`;

  await pushMessage(groupId, text, token);
  console.log(`notify sent: ${dateKey} ${hhmm} → ${groupId}`);
  return res.status(200).send('sent');
}
