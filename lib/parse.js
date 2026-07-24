// แปลงข้อความ #ตรวจเงิน เป็นข้อมูลมีโครงสร้าง — logic ล้วน ทดสอบได้ตรงๆ

export const TRIGGER = '#ตรวจเงิน';

export const BRANCHES = ['หนองดอก', 'จอมทอง', 'บ้านเส้ง'];
export const SHIFTS = ['เช้า', 'บ่าย'];

/** ข้อความนี้เป็นใบตรวจเงินหรือไม่ */
export function isReport(text) {
  return typeof text === 'string' && text.includes(TRIGGER);
}

/**
 * parse ข้อความใบตรวจเงิน
 * @returns {{ok:true, data:{branch,shift,cash,pos}} | {ok:false, errors:string[]}}
 */
export function parseReport(text) {
  const errors = [];
  const branch = matchOneOf(text, BRANCHES);
  const shift = matchOneOf(text, SHIFTS);
  const cash = matchNumber(text, ['เงินสด', 'สด']);
  const pos = matchNumber(text, ['POS', 'pos', 'ยอด', 'ยอดขาย']);

  if (!branch) errors.push(`ไม่พบสาขา (ต้องเป็นหนึ่งใน: ${BRANCHES.join(' / ')})`);
  if (!shift) errors.push(`ไม่พบกะ (ต้องเป็น: ${SHIFTS.join(' / ')})`);
  if (cash == null) errors.push('ไม่พบยอดเงินสด (เช่น "เงินสด: 8200")');
  if (pos == null) errors.push('ไม่พบยอด POS (เช่น "POS: 15000")');

  if (errors.length) return { ok: false, errors };
  return { ok: true, data: { branch, shift, cash, pos } };
}

function matchOneOf(text, options) {
  for (const o of options) if (text.includes(o)) return o;
  return null;
}

/**
 * ดึงตัวเลขที่อยู่หลัง label ตัวใดตัวหนึ่ง เช่น "เงินสด: 8,200" -> 8200
 * รองรับ : = เว้นวรรค และคอมมาคั่นหลักพัน
 */
function matchNumber(text, labels) {
  for (const label of labels) {
    const re = new RegExp(label + '\\s*[:：=]?\\s*([0-9][0-9,\\.]*)');
    const m = text.match(re);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}
