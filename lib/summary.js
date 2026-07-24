// รวมยอด + สรุป 2 ช่วงเวลา (00:01–12:00 / 12:01–23:59) + ทั้งวัน — ใช้ร่วมกันทั้ง webhook, dashboard, notify

export function fmtBaht(n) {
  return Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// เวลาไทย (UTC+7)
export function bangkokParts(ts) {
  const d = new Date(ts + 7 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return {
    dateKey: `${yyyy}-${mm}-${dd}`,
    dateLabel: `${dd}/${mm}/${yyyy}`,
    hhmm: `${hh}:${mi}`,
  };
}

/** แปลง "DD/MM/YYYY" (รองรับปี พ.ศ.) → "YYYY-MM-DD" ค.ศ. หรือ null ถ้าอ่านไม่ได้ */
export function normalizeThaiDate(s) {
  const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec((s || '').trim());
  if (!m) return null;
  let [, d, mo, y] = m;
  let year = parseInt(y, 10);
  if (year < 100) year += 2500;          // "69" → 2569 (พ.ศ.แบบย่อ)
  if (year > 2400) year -= 543;          // พ.ศ. → ค.ศ.
  const day = parseInt(d, 10);
  const mon = parseInt(mo, 10);
  if (day < 1 || day > 31 || mon < 1 || mon > 12 || year < 2000 || year > 2100) return null;
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function splitWindows(records) {
  return {
    morning: records.filter((r) => toMinutes(r.time) <= 12 * 60),   // 00:01–12:00
    afternoon: records.filter((r) => toMinutes(r.time) > 12 * 60),  // 12:01–23:59
  };
}

export function totals(records) {
  const sum = (key) => {
    const vals = records.map((r) => r[key]).filter((v) => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  };
  const cash = sum('cashSales');
  const deposit = sum('deposit');
  const slips = sum('slipsTotal');
  const actual = deposit ?? slips;
  let diff = null;
  if (cash != null && actual != null) diff = Math.round((actual - cash) * 100) / 100;
  return {
    count: records.length,
    cash,
    transfer: sum('transferSales'),
    epay: sum('epayment'),
    deposit,
    slips,
    diff,
  };
}

export function sectionSummary(title, records) {
  if (!records.length) return [title, '   — ไม่มีรายงาน —'];
  const t = totals(records);
  const lines = [`${title} — ${t.count} รายการ`];
  if (t.cash != null) lines.push(`   🧾 ขายเงินสด: ${fmtBaht(t.cash)} บาท`);
  if (t.transfer != null) lines.push(`   🏦 ขายโอน: ${fmtBaht(t.transfer)} บาท`);
  if (t.epay != null) lines.push(`   📱 E-Payment: ${fmtBaht(t.epay)} บาท`);
  if (t.deposit != null) lines.push(`   💵 นำส่งจริง: ${fmtBaht(t.deposit)} บาท`);
  if (t.slips != null) lines.push(`   🧾 รวมสลิป: ${fmtBaht(t.slips)} บาท`);
  if (t.diff != null) {
    if (Math.abs(t.diff) < 0.005) lines.push('   ✅ พอดี');
    else if (t.diff > 0) lines.push(`   🔺 เกิน: ${fmtBaht(t.diff)} บาท`);
    else lines.push(`   🔻 ขาด: ${fmtBaht(Math.abs(t.diff))} บาท`);
  }
  return lines;
}

export function buildDailySummary(records, dateLabel) {
  if (!records.length) {
    return `📊 สรุปวันที่ ${dateLabel}\nยังไม่มีรายงานที่บันทึกไว้ในวันนี้`;
  }
  const { morning, afternoon } = splitWindows(records);
  const lines = [`📊 สรุปวันที่ ${dateLabel}`];
  lines.push('');
  lines.push(...sectionSummary('🌅 ช่วง 00:01–12:00', morning));
  lines.push('');
  lines.push(...sectionSummary('🌇 ช่วง 12:01–23:59', afternoon));
  lines.push('');
  lines.push(...sectionSummary('📦 รวมทั้งวัน (00:01–23:59)', records));
  return lines.join('\n');
}
