// คำนวณกระทบยอด — logic ล้วน ไม่พึ่ง network (ทดสอบได้ตรงๆ)

/**
 * @param {number} cash  เงินสดที่นับได้
 * @param {number} transfer  รวมยอดโอน (จากสลิป)
 * @param {number} pos  ยอดขายเครื่อง POS
 * @returns {{received:number, diff:number, status:'ตรง'|'ขาด'|'เกิน'}}
 */
export function reconcile(cash, transfer, pos) {
  const received = round2((cash || 0) + (transfer || 0));
  const diff = round2(received - (pos || 0));
  let status;
  if (Math.abs(diff) < 0.005) status = 'ตรง';
  else if (diff > 0) status = 'เกิน';
  else status = 'ขาด';
  return { received, diff, status };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
