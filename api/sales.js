// แดชบอร์ดยอดขายรายสาขา (ข้อมูลจากเมล SeniorSoft ProMaxx รอบปิดวัน 20:10)
// เปิดที่ https://<โปรเจกต์>.vercel.app/api/sales
// ถ้าตั้ง DASHBOARD_KEY ไว้ ต้องเปิดด้วย ?k=<key> (ใช้ key เดียวกับ /api/dashboard)
//
// ข้อมูลฝังในไฟล์นี้ — อัปเดตโดยเติมแถวใหม่ใน DATA แล้ว push (บรรทัดละวัน, ใหม่สุดอยู่ล่าง)

const BRANCHES = [
  { key: 'nongdok', name: 'หนองดอก', color: '#4e79a7' },
  { key: 'chomthong', name: 'จอมทอง', color: '#f28e2b' },
  { key: 'bansen', name: 'บ้านเส้ง', color: '#59a14f' },
];

// [date, จอมทอง, หนองดอก, บ้านเส้ง]  (ทรัพย์เพิ่มพูนยอด ~0 ตลอด ไม่แสดง)
const DATA = [
  ['2026-07-05', 83058.54, 151482.38, 54861.50],
  ['2026-07-06', 71436.46, 112320.55, 40275.82],
  ['2026-07-07', 69021.42, 116147.42, 39029.53],
  ['2026-07-08', 74707.21, 111027.62, 33542.94],
  ['2026-07-09', 77670.49, 119767.73, 34813.49],
  ['2026-07-10', 70742.95, 115083.38, 37796.69],
  ['2026-07-11', 88163.69, 131607.43, 47561.13],
  ['2026-07-12', 85702.48, 121441.55, 42898.25],
  ['2026-07-13', 72431.29, 115475.45, 41481.60],
  ['2026-07-14', 74152.40, 103568.23, 38545.64],
  ['2026-07-15', 70982.33, 111713.67, 35409.47],
  ['2026-07-16', 71099.77, 112193.79, 38721.00],
  ['2026-07-17', 68088.73, 96553.53, 38890.04],
  ['2026-07-18', 81973.63, 118509.82, 39830.32],
  ['2026-07-19', 69569.72, 139207.08, 49967.25],
  ['2026-07-20', 69864.95, 121918.68, 36726.17],
  ['2026-07-21', 63084.84, 120772.53, 29008.06],
  ['2026-07-22', 63558.59, 120849.72, 34678.63],
  ['2026-07-23', 65925.12, 122343.28, 31528.72],
  ['2026-07-24', 63762.52, 106730.92, 35394.35],
  ['2026-07-25', 71611.72, 125178.70, 34922.39],
  ['2026-07-26', 76330.33, 130083.30, 35770.88],
  ['2026-07-27', 77294.70, 105852.76, 36185.75],
  ['2026-07-28', 94642.67, 122492.59, 47786.25],
  ['2026-07-29', 77212.97, 103977.06, 36625.03],
  ['2026-07-30', 86631.43, 122592.18, 40062.50],
  ['2026-07-31', 74362.07, 128497.77, 35384.52],
  ['2026-08-01', 91072.82, 117534.11, 41155.03],
  ['2026-08-02', 98582.52, 137760.48, 53609.67],
  ['2026-08-03', 74330.56, 114198.17, 40275.33],
];

const TH_M = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_D = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

function thDate(iso, withDow = false) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return `${withDow ? TH_D[dow] + ' ' : ''}${d} ${TH_M[m]}`;
}
const baht = (n) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });
const isWeekend = (iso) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

export default function handler(req, res) {
  if (process.env.DASHBOARD_KEY && req.query?.k !== process.env.DASHBOARD_KEY) {
    return res.status(401).send('unauthorized');
  }
  const rows = DATA.map(([date, chomthong, nongdok, bansen]) => ({
    date, chomthong, nongdok, bansen, total: chomthong + nongdok + bansen,
  }));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(renderHtml(rows));
}

function renderHtml(rows) {
  const n = rows.length;
  const total = rows.reduce((s, r) => s + r.total, 0);
  const last7 = rows.slice(-7).reduce((s, r) => s + r.total, 0);
  const prev7 = rows.slice(-14, -7).reduce((s, r) => s + r.total, 0);
  const wow = prev7 ? ((last7 - prev7) / prev7) * 100 : 0;
  const best = rows.reduce((a, b) => (b.total > a.total ? b : a));
  const worst = rows.reduce((a, b) => (b.total < a.total ? b : a));
  const bTotals = BRANCHES.map((b) => ({ ...b, sum: rows.reduce((s, r) => s + r[b.key], 0) }));

  // กราฟแท่งซ้อนรายวัน (SVG)
  const W = 940, H = 260, PAD_L = 56, PAD_B = 34, PAD_T = 10;
  const maxT = Math.max(...rows.map((r) => r.total));
  const innerW = W - PAD_L - 8, innerH = H - PAD_T - PAD_B;
  const bw = innerW / n;
  const bars = rows.map((r, i) => {
    const x = PAD_L + i * bw;
    let y = H - PAD_B;
    const segs = BRANCHES.map((b) => {
      const h = (r[b.key] / maxT) * innerH;
      y -= h;
      return `<rect x="${(x + bw * 0.12).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${h.toFixed(1)}" fill="${b.color}"><title>${thDate(r.date, true)} · ${b.name} ${baht(r[b.key])} บ.</title></rect>`;
    }).join('');
    const [, , d] = r.date.split('-');
    const label = (i % 2 === 0 || n <= 16)
      ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - PAD_B + 14}" text-anchor="middle" class="tick${isWeekend(r.date) ? ' wk' : ''}">${Number(d)}</text>` : '';
    return segs + label;
  }).join('');
  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => {
    const y = H - PAD_B - innerH * f;
    return `<line x1="${PAD_L}" y1="${y}" x2="${W - 8}" y2="${y}" class="grid"/>` +
      `<text x="${PAD_L - 6}" y="${y + 4}" text-anchor="end" class="tick">${baht(maxT * f / 1000)}k</text>`;
  }).join('');

  const branchRows = bTotals.map((b) => `
      <tr><td><span class="dot" style="background:${b.color}"></span>${b.name}</td>
      <td>${baht(b.sum)}</td><td>${((b.sum / total) * 100).toFixed(0)}%</td><td>${baht(b.sum / n)}</td></tr>`).join('');

  const dailyRows = [...rows].reverse().map((r) => `
      <tr${isWeekend(r.date) ? ' class="wkrow"' : ''}><td>${thDate(r.date, true)}</td>
      <td>${baht(r.chomthong)}</td><td>${baht(r.nongdok)}</td><td>${baht(r.bansen)}</td>
      <td><b>${baht(r.total)}</b></td></tr>`).join('');

  return `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>แดชบอร์ดยอดขาย มั่งมีฟู้ดส์</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, 'Segoe UI', sans-serif; margin: 0; padding: 16px; background: #f4f6f9; color: #1c2733; }
  @media (prefers-color-scheme: dark) { body { background: #10151c; color: #e6edf3; } .card, .list { background: #1a222d !important; } }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  .sub { color: #7a8794; font-size: .85rem; margin-bottom: 14px; }
  .grid4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 12px; }
  .card { background: #fff; border-radius: 14px; padding: 12px 16px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .card .t { color: #7a8794; font-size: .78rem; }
  .card .v { font-size: 1.25rem; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .card .s { font-size: .78rem; color: #7a8794; margin-top: 2px; }
  .up { color: #0f8a4b; } .down { color: #c0392b; }
  .list { background: #fff; border-radius: 14px; padding: 14px 16px; margin-top: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow-x: auto; }
  .list h2 { font-size: 1rem; margin: 0 0 8px; }
  svg { width: 100%; height: auto; display: block; }
  .grid { stroke: rgba(125,140,155,.25); stroke-width: 1; }
  .tick { font-size: 10px; fill: #7a8794; }
  .tick.wk { fill: #c0392b; }
  table { width: 100%; border-collapse: collapse; font-size: .88rem; }
  th, td { padding: 6px 8px; text-align: right; font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child { text-align: left; }
  thead th { border-bottom: 2px solid #dde3ea; color: #7a8794; font-weight: 600; }
  tbody tr:nth-child(even) { background: rgba(125,140,155,.07); }
  tr.wkrow td:first-child { color: #c0392b; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: .82rem; color: #7a8794; margin-top: 6px; }
  footer { color: #7a8794; font-size: .75rem; margin-top: 14px; }
</style></head>
<body>
  <h1>📊 แดชบอร์ดยอดขาย มั่งมีฟู้ดส์</h1>
  <div class="sub">${thDate(rows[0].date)} – ${thDate(rows[n - 1].date)} 2569 (${n} วัน) · จากเมล SeniorSoft ProMaxx รอบปิดวัน 20:10</div>

  <div class="grid4">
    <div class="card"><div class="t">💰 ยอดรวม ${n} วัน</div><div class="v">${baht(total)}</div><div class="s">เฉลี่ย ${baht(total / n)}/วัน</div></div>
    <div class="card"><div class="t">📈 7 วันล่าสุด</div><div class="v">${baht(last7)}</div>
      <div class="s ${wow >= 0 ? 'up' : 'down'}">${wow >= 0 ? '▲' : '▼'} ${Math.abs(wow).toFixed(1)}% เทียบ 7 วันก่อน</div></div>
    <div class="card"><div class="t">🔺 ขายดีสุด</div><div class="v">${baht(best.total)}</div><div class="s">${thDate(best.date, true)}</div></div>
    <div class="card"><div class="t">🔻 ต่ำสุด</div><div class="v">${baht(worst.total)}</div><div class="s">${thDate(worst.date, true)}</div></div>
  </div>

  <div class="list">
    <h2>ยอดขายรายวัน (แยกสาขา)</h2>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟยอดขายรายวัน">${gridLines}${bars}</svg>
    <div class="legend">${BRANCHES.map((b) => `<span><span class="dot" style="background:${b.color}"></span>${b.name}</span>`).join('')}
      <span style="color:#c0392b">· เลขวันที่สีแดง = เสาร์–อาทิตย์</span></div>
  </div>

  <div class="list">
    <h2>สรุปรายสาขา</h2>
    <table>
      <thead><tr><th>สาขา</th><th>รวม ${n} วัน</th><th>สัดส่วน</th><th>เฉลี่ย/วัน</th></tr></thead>
      <tbody>${branchRows}
      <tr><td><b>รวม</b></td><td><b>${baht(total)}</b></td><td><b>100%</b></td><td><b>${baht(total / n)}</b></td></tr></tbody>
    </table>
  </div>

  <div class="list">
    <h2>ตารางรายวัน (ใหม่ → เก่า)</h2>
    <table>
      <thead><tr><th>วันที่</th><th>จอมทอง</th><th>หนองดอก</th><th>บ้านเส้ง</th><th>รวม</th></tr></thead>
      <tbody>${dailyRows}</tbody>
    </table>
  </div>

  <footer>ข้อมูลจากเมลรายงาน ProMaxx (backfill 30 วัน) · สาขาทรัพย์เพิ่มพูนยอดเป็นศูนย์ตลอดช่วง จึงไม่แสดง · อัปเดตข้อมูลโดยแก้ DATA ใน api/sales.js</footer>
</body></html>`;
}
