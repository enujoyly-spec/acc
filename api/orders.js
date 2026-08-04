// รายการที่ "สั่งแล้ว" ของวันนั้น — เครื่องร้านดึงไปตัดออกจากคำแนะนำสั่งซื้อ
// GET /api/orders?date=YYYY-MM-DD   (ไม่ใส่ date = วันนี้ตามเวลาไทย)
import { loadOrders, todayBangkok, blobReady } from '../lib/mangmee.js';

export default async function handler(req, res) {
  const date = (req.query?.date || '').match(/^\d{4}-\d{2}-\d{2}$/)
    ? req.query.date
    : todayBangkok();

  if (!blobReady()) {
    return res.status(200).json({ date, items: [], note: 'blob not configured' });
  }
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ date, items: await loadOrders(date) });
  } catch (e) {
    return res.status(200).json({ date, items: [], error: String(e) });
  }
}
