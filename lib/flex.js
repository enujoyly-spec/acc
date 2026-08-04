// กล่องข้อความ LINE แดง–ขาว — โครงเดียวกับรายงานรายวันที่ mangmee.py ส่ง
// (ดู _fx_bubble ใน mangmee.py) เพื่อให้บอทกับรายงานหน้าตาเป็นชุดเดียวกัน
export const RED = '#D8434E';
export const INK = '#1F2937';
export const MUTED = '#8A94A6';
export const LINE_C = '#E8EDF4';
export const GREEN = '#3BA776';
export const ON_RED = '#FFDDE0';

export function txt(text, o = {}) {
  const t = { type: 'text', text: String(text), size: o.size || 'sm' };
  for (const k of ['color', 'weight', 'align', 'flex', 'margin']) {
    if (o[k] !== undefined) t[k] = o[k];
  }
  if (o.wrap) t.wrap = true;
  return t;
}

export const sep = (margin = 'md') => ({ type: 'separator', margin, color: LINE_C });

export const head = (text, margin = 'lg') =>
  txt(text, { size: 'xs', color: MUTED, weight: 'bold', margin });

export const row = (contents, margin = 'sm') => ({
  type: 'box', layout: 'horizontal', margin, contents,
});

/** แถวมาตรฐาน: ชื่อ | ตัวเลข | หมายเหตุขวาสุด */
export const kv = (label, value, note, o = {}) =>
  row([
    txt(label, { color: o.strong ? INK : MUTED, weight: o.strong ? 'bold' : undefined, flex: 5 }),
    txt(value, { color: o.hot ? RED : INK, weight: 'bold', align: 'end', flex: 5 }),
    ...(note === undefined ? [] : [txt(note, { size: 'xs', color: MUTED, align: 'end', flex: 3 })]),
  ]);

/** แถวอันดับ: เลขแดง | ชื่อ | กลาง | ขวา */
export const rankRow = (i, name, mid, right) =>
  row([
    txt(i, { size: 'xs', color: RED, weight: 'bold', flex: 1 }),
    txt(name, { size: 'sm', color: INK, flex: 9, wrap: true }),
    txt(mid, { size: 'xs', color: MUTED, align: 'end', flex: 6 }),
    txt(right, { size: 'sm', color: INK, weight: 'bold', align: 'end', flex: 6 }),
  ]);

export function bubble(title, sub, body) {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: RED,
      contents: [
        txt(title, { size: 'lg', color: '#FFFFFF', weight: 'bold' }),
        txt(sub, { size: 'xs', color: ON_RED, margin: 'xs', wrap: true }),
      ],
    },
    body: {
      type: 'box', layout: 'vertical', paddingAll: '16px',
      backgroundColor: '#FFFFFF', contents: body,
    },
  };
}

/** ห่อเป็น message object พร้อมส่ง — altText เป็นข้อความสำรองสำหรับ notification */
export const flexMsg = (altText, contents) => ({
  type: 'flex', altText: String(altText).slice(0, 400), contents,
});
