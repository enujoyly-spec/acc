// แดชบอร์ดสรุปยอดวันนี้ — เปิดที่ https://<โปรเจกต์>.vercel.app/api/dashboard
// รีเฟรชตัวเองทุก 60 วินาที / ถ้าตั้ง DASHBOARD_KEY ไว้ ต้องเปิดด้วย ?k=<key>
import { storeReady, loadDay } from '../lib/store.js';
import { bangkokParts, splitWindows, totals, fmtBaht } from '../lib/summary.js';

export default async function handler(req, res) {
  if (process.env.DASHBOARD_KEY && req.query?.k !== process.env.DASHBOARD_KEY) {
    return res.status(401).send('unauthorized');
  }

  const { dateKey, dateLabel } = bangkokParts(Date.now());
  let records = [];
  let storeMsg = '';
  if (!storeReady()) {
    storeMsg = 'ยังไม่ได้เปิด Vercel Blob (Storage → Blob → Connect Project)';
  } else {
    try {
      records = await loadDay(dateKey);
    } catch (e) {
      storeMsg = 'อ่านข้อมูลไม่ได้: ' + (e?.message || '');
    }
  }

  const { morning, afternoon } = splitWindows(records);
  const cards = [
    { title: '🌅 ช่วง 00:01–12:00', t: totals(morning) },
    { title: '🌇 ช่วง 12:01–23:59', t: totals(afternoon) },
    { title: '📦 รวมทั้งวัน', t: totals(records) },
  ];

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(renderHtml(dateLabel, cards, records, storeMsg));
}

function money(v) {
  return v == null ? '—' : fmtBaht(v);
}

function diffBadge(diff) {
  if (diff == null) return '<span class="badge">—</span>';
  if (Math.abs(diff) < 0.005) return '<span class="badge ok">✅ พอดี</span>';
  if (diff > 0) return `<span class="badge over">🔺 เกิน ${fmtBaht(diff)}</span>`;
  return `<span class="badge short">🔻 ขาด ${fmtBaht(Math.abs(diff))}</span>`;
}

function renderHtml(dateLabel, cards, records, storeMsg) {
  const cardHtml = cards.map(({ title, t }) => `
    <div class="card">
      <h2>${title}</h2>
      <div class="n">${t.count} รายการ</div>
      <table>
        <tr><td>🧾 ขายเงินสด</td><td>${money(t.cash)}</td></tr>
        <tr><td>🏦 ขายโอน</td><td>${money(t.transfer)}</td></tr>
        <tr><td>📱 E-Payment</td><td>${money(t.epay)}</td></tr>
        <tr><td>💵 นำส่งจริง</td><td>${money(t.deposit)}</td></tr>
        <tr><td>🧾 รวมสลิป</td><td>${money(t.slips)}</td></tr>
      </table>
      <div class="diff">${diffBadge(t.diff)}</div>
    </div>`).join('');

  const rows = records.map((r, i) => `
    <tr>
      <td>${i + 1}</td><td>${r.time || '—'}</td>
      <td>${money(r.cashSales)}</td><td>${money(r.transferSales)}</td>
      <td>${money(r.epayment)}</td><td>${money(r.deposit)}</td><td>${money(r.slipsTotal)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>แดชบอร์ดตรวจเงินร้าน</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, 'Segoe UI', sans-serif; margin: 0; padding: 16px; background: #f4f6f9; color: #1c2733; }
  @media (prefers-color-scheme: dark) { body { background: #10151c; color: #e6edf3; } .card, .list { background: #1a222d !important; } }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  .sub { color: #7a8794; font-size: .85rem; margin-bottom: 16px; }
  .warn { background: #fff3cd; color: #664d03; padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .card { background: #fff; border-radius: 14px; padding: 14px 16px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .card h2 { font-size: 1rem; margin: 0 0 2px; }
  .card .n { color: #7a8794; font-size: .8rem; margin-bottom: 8px; }
  .card table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  .card td { padding: 3px 0; }
  .card td:last-child { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .diff { margin-top: 10px; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: .85rem; background: #e9ecf1; }
  .badge.ok { background: #d1e7dd; color: #0f5132; }
  .badge.over { background: #fff3cd; color: #664d03; }
  .badge.short { background: #f8d7da; color: #842029; }
  .list { background: #fff; border-radius: 14px; padding: 14px 16px; margin-top: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow-x: auto; }
  .list h2 { font-size: 1rem; margin: 0 0 8px; }
  .list table { width: 100%; border-collapse: collapse; font-size: .85rem; min-width: 560px; }
  .list th, .list td { padding: 6px 8px; text-align: right; font-variant-numeric: tabular-nums; }
  .list th:nth-child(-n+2), .list td:nth-child(-n+2) { text-align: left; }
  .list thead th { border-bottom: 2px solid #dde3ea; color: #7a8794; font-weight: 600; }
  .list tbody tr:nth-child(even) { background: rgba(125,140,155,.07); }
  footer { color: #7a8794; font-size: .75rem; margin-top: 14px; }
</style></head>
<body>
  <h1>📊 แดชบอร์ดตรวจเงินร้าน</h1>
  <div class="sub">วันที่ ${dateLabel} · อัปเดตอัตโนมัติทุก 60 วินาที</div>
  ${storeMsg ? `<div class="warn">⚠️ ${storeMsg}</div>` : ''}
  <div class="grid">${cardHtml}</div>
  <div class="list">
    <h2>รายการวันนี้ (${records.length})</h2>
    <table>
      <thead><tr><th>#</th><th>เวลา</th><th>ขายเงินสด</th><th>ขายโอน</th><th>E-Pay</th><th>นำส่ง</th><th>รวมสลิป</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#7a8794">ยังไม่มีรายการ</td></tr>'}</tbody>
    </table>
  </div>
  <footer>slip-reader-bot · หน้าเว็บนี้ดึงข้อมูลจากรูปที่บอทอ่านในกลุ่มไลน์</footer>
</body></html>`;
}
