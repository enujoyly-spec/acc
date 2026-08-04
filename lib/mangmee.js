// ตัวช่วยฝั่งบอท: อ่านสรุปยอดที่ mangmee.py สร้างไว้ + จำว่าของอะไรสั่งไปแล้ว
//
// data.json ถูก build ที่เครื่องร้านแล้ว push ขึ้นมาพร้อมหน้าเว็บ (public/mangmee/data.json)
// ส่วน "สั่งแล้ว" ผู้ใช้พิมพ์ในไลน์ จึงต้องเก็บฝั่งนี้ — ใช้ Vercel Blob ตัวเดียวกับบอทสลิป
import { get, put } from '@vercel/blob';
import {
  txt, sep, head, kv, rankRow, bubble, flexMsg, lead as leadLine,
  RED, INK, MUTED, GREEN,
} from './flex.js';

const ORDERS_PREFIX = 'mangmee/orders/';

export function blobReady() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** วันนี้ตามเวลาไทย (YYYY-MM-DD) — เซิร์ฟเวอร์ Vercel เป็น UTC */
export function todayBangkok(ms = Date.now()) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** อ่านสรุปยอดล่าสุด — อ่านจากไฟล์ที่ deploy มาด้วยกัน จึงไม่ต้องยิงออกนอก */
export async function loadSnapshot(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const r = await fetch(`${proto}://${host}/mangmee/data.json`, {
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`data.json ${r.status}`);
  return r.json();
}

// อ่าน/เขียน Blob แบบเดียวกับ lib/store.js — get() คืน { stream } ไม่ใช่ URL
// และ useCache:false จำเป็นกับ read-modify-write ไม่งั้นได้ค่าเก่ามาเขียนทับ
async function readJson(pathname) {
  try {
    const res = await get(pathname, { access: 'private', useCache: false });
    if (!res || !res.stream) return null;
    return await new Response(res.stream).json();
  } catch {
    return null;
  }
}

async function writeJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export async function loadOrders(dateKey) {
  if (!blobReady()) return [];
  const v = await readJson(`${ORDERS_PREFIX}${dateKey}.json`);
  return Array.isArray(v?.items) ? v.items : [];
}

export async function addOrder(dateKey, name) {
  if (!blobReady()) return null;
  const items = await loadOrders(dateKey);
  const key = name.trim();
  if (!key) return items;
  if (!items.some((x) => x.toLowerCase() === key.toLowerCase())) items.push(key);
  await writeJson(`${ORDERS_PREFIX}${dateKey}.json`, { items });
  return items;
}

export async function removeOrder(dateKey, name) {
  if (!blobReady()) return null;
  const items = (await loadOrders(dateKey)).filter(
    (x) => x.toLowerCase() !== name.trim().toLowerCase(),
  );
  await writeJson(`${ORDERS_PREFIX}${dateKey}.json`, { items });
  return items;
}

const baht = (n) => Number(n || 0).toLocaleString('en-US');

/** กล่องคำตอบมาตรฐาน — ประโยคตอบอยู่ในกล่อง ไม่มีข้อความลอยนอกกล่อง */
const card = (leadText, title, sub, body) => [
  flexMsg(leadText, bubble(title, sub, [leadLine(leadText), sep(), ...body])),
];

/**
 * กล่องข้อความล้วน — ใช้กับคำตอบที่ไม่มีตัวเลขรายงาน (เมนู, แจ้งเตือน, ข้อผิดพลาด)
 * มีไว้เพื่อให้ทุกคำตอบของบอทเป็นกล่องแดง–ขาวเหมือนกันหมด
 */
export function notice(title, sub, lines, opts = {}) {
  const body = lines.filter(Boolean).map((l, i) =>
    txt(l, { size: 'sm', color: opts.hot && i === 0 ? RED : INK,
             weight: opts.hot && i === 0 ? 'bold' : undefined,
             margin: i ? 'sm' : undefined, wrap: true }));
  return [flexMsg(lines.filter(Boolean).join(' '), bubble(title, sub, body))];
}

/** กล่องยืนยันตอนบันทึกว่าสั่งของแล้ว / ยกเลิก */
export function orderAck(name, added, orders, leftCount) {
  const title = added ? 'บันทึกว่าสั่งแล้ว' : 'เอากลับเข้ารายการ';
  const lead = `${added ? '✅' : '↩️'} ${name} — ` +
               `${added ? 'จำไว้แล้ว' : 'เอากลับเข้ารายการแล้ว'}` +
               (leftCount === null ? '' : `\nเหลือที่ยังต้องสั่งอีก ${leftCount} รายการ`);
  const body = [
    txt(name, { size: 'xl', color: RED, weight: 'bold', align: 'center', wrap: true }),
    txt(added ? 'สั่งแล้ว — จะไม่แนะนำซ้ำ' : 'ยังไม่ได้สั่ง — กลับเข้ารายการแล้ว',
        { size: 'xxs', color: MUTED, align: 'center' }),
  ];
  if (leftCount !== null) {
    body.push(sep(), kv('เหลือที่ยังต้องสั่ง', `${leftCount} รายการ`, undefined,
                        { strong: true, hot: true }));
  }
  if (orders.length) {
    body.push(sep(), head('สั่งแล้ววันนี้', 'md'),
              txt(orders.join(', '), { size: 'xs', color: MUTED, margin: 'sm', wrap: true }));
  }
  return card(lead, title, `${orders.length} รายการที่สั่งแล้ววันนี้`, body);
}

/**
 * ตีความข้อความไทยแบบสั้นๆ ด้วยคำสำคัญ — ไม่ต้องพึ่ง LLM สำหรับคำถามที่ถามบ่อย
 * คืน null ถ้าไม่เข้าเคสไหนเลย (ให้ผู้เรียกไปต่อด้วย LLM)
 */
export function routeText(text) {
  const t = (text || '').trim();
  if (!t) return null;

  // ถ้าเอ่ยถึงวันใดวันหนึ่งโดยเฉพาะ ให้ AI ตอบจากประวัติรายวันแทน
  // ไม่งั้น "ยอดวันที่ 1" จะไปเข้าคำสั่ง "ยอด" แล้วตอบยอดของวันล่าสุดผิดวัน
  if (/วันที่\s*\d|\d{1,2}\s*[/-]\s*\d{1,2}|\d{1,2}\s*(ม\.ค|ก\.พ|มี\.ค|เม\.ย|พ\.ค|มิ\.ย|ก\.ค|ส\.ค|ก\.ย|ต\.ค|พ\.ย|ธ\.ค)/.test(t)) {
    return null;
  }

  // "เศษเนื้อแดงสั่งแล้ว" / "เศษเนื้อแดง สั่งแล้ว" / "ซื้อเศษเนื้อแดงแล้ว"
  // ต้องมีคำว่า สั่ง/ซื้อ อยู่ด้วย — ถ้าจับแค่ "…แล้ว" ประโยคทั่วไปอย่าง
  // "ปิดร้านแล้ว" จะกลายเป็นการสั่งของไปด้วย
  let ordered = t.match(/^(.+?)\s*(?:สั่งแล้ว|สั่งไปแล้ว|ซื้อแล้ว|ซื้อไปแล้ว)$/);
  if (!ordered) ordered = t.match(/^(?:สั่ง|ซื้อ)\s*(.+?)\s*(?:ไป)?แล้ว$/);
  if (ordered && ordered[1] && !/^(สรุป|ยอด|เงินสด|ขายดี|โอน)/.test(ordered[1])) {
    return { kind: 'order-add', name: ordered[1].trim() };
  }
  const undo = t.match(/^(?:ยกเลิก|เอาคืน|ยังไม่ได้สั่ง)\s*(.+)$/);
  if (undo) return { kind: 'order-del', name: undo[1].trim() };

  if (/^(สั่งอะไร|ต้องสั่ง|แนะนำสั่ง|รายการสั่ง|สั่งของ)/.test(t)) return { kind: 'order-list' };
  if (/เงินสด/.test(t)) return { kind: 'cash' };
  if (/โอน/.test(t)) return { kind: 'transfer' };
  if (/ขายดี|ขายด[ีิ]/.test(t)) return { kind: 'top' };
  if (/สาขา/.test(t)) return { kind: 'branches' };
  if (/ยอด|ขายวันนี้|วันนี้ได้/.test(t)) return { kind: 'sales' };
  if (/^(ช่วย|help|เมนู|ทำอะไรได้)/i.test(t)) return { kind: 'help' };
  return null;
}

/**
 * ตอบเป็น [ข้อความสั้นๆ, กล่องรายงานแดง–ขาว]
 * ข้อความมาก่อนเพื่อตอบคำถามตรงๆ แล้วค่อยตามด้วยตัวเลขในกล่องแบบรายงาน
 */
export function answer(kind, snap, orders) {
  const s = snap.sales, c = snap.cash;
  const sub = `${snap.dayLabel} · ${snap.shop}`;
  const pct = (v, base) => (base ? `${Math.round((v / base) * 100)}%` : '—');

  switch (kind) {
    case 'sales': {
      const diff = s.total - snap.avg30;
      const arrow = diff >= 0 ? '▲' : '▼';
      const pc = (Math.abs(diff) / (snap.avg30 || 1) * 100).toFixed(1);
      const lead = `ยอดขาย ${snap.dayLabel} อยู่ที่ ${baht(s.total)} บาทครับ ` +
                   `${diff >= 0 ? 'สูงกว่า' : 'ต่ำกว่า'}เฉลี่ย 30 วัน ${pc}%`;
      const b = [
        txt(baht(s.total), { size: '3xl', color: RED, weight: 'bold', align: 'center' }),
        txt('บาท', { size: 'xxs', color: MUTED, align: 'center' }),
        txt(`${arrow} ${pc}% เทียบเฉลี่ย 30 วัน (${baht(snap.avg30)}/วัน)`,
            { size: 'xs', color: diff >= 0 ? GREEN : RED, align: 'center', margin: 'sm' }),
      ];
      if (s.hasShift) {
        b.push(sep(), head('แยกกะ', 'md'),
               kv('กะเช้า (ถึงรอบเที่ยง)', baht(s.am), pct(s.am, s.total)),
               kv('กะบ่าย (รอบเที่ยง–ปิดวัน)', baht(s.pm), pct(s.pm, s.total)));
      }
      b.push(sep(), head('แยกสาขา', 'md'),
             ...s.branches.map((x) => kv(x.name, baht(x.amount), `${x.pct}%`)));
      return card(lead, 'ยอดขายประจำวัน', sub, b);
    }

    case 'cash': {
      if (!c.hasData) {
        const lead = `${snap.dayLabel} ยอดขาย ${baht(s.total)} บาทครับ ` +
                     'แต่ยังไม่ได้รับไฟล์เงินโอน เลยยังบอกเงินสดไม่ได้';
        return card(lead, 'เงินสดที่ต้องได้', sub, [
          kv('ยอดขาย (ปิดวัน)', baht(s.total), '100%'),
          kv('หัก เงินโอน', '—', '—'),
          kv('เงินสดที่ต้องได้', '—', '—', { strong: true, hot: true }),
          txt('ยังไม่ได้รับไฟล์เงินโอนของวันนี้ — อัปไฟล์ธนาคารแล้วตัวเลขจะเติมให้เอง',
              { size: 'xxs', color: MUTED, margin: 'md', wrap: true }),
        ]);
      }
      const lead = `เงินสดที่ต้องได้วันนี้ ${baht(c.cash)} บาทครับ ` +
                   `(ยอดขาย ${baht(c.sales)} หักโอน ${baht(c.transfer)})`;
      const b = [
        txt(baht(c.cash), { size: '3xl', color: RED, weight: 'bold', align: 'center' }),
        txt('บาท — เงินสดที่ต้องได้', { size: 'xxs', color: MUTED, align: 'center' }),
        sep(), head('ที่มา', 'md'),
        kv('ยอดขาย (ปิดวัน)', baht(c.sales), '100%'),
        kv('หัก เงินโอน', `−${baht(c.transfer)}`, pct(c.transfer, c.sales)),
        kv('คงเหลือเป็นเงินสด', baht(c.cash), pct(c.cash, c.sales), { strong: true, hot: true }),
        sep(), head('โอนเข้าบัญชีไหนบ้าง', 'md'),
        ...c.accounts.map((a) => kv(`${a.bank.replace('ธนาคาร', '')} ${a.acc}`,
                                    baht(a.amount), pct(a.amount, c.transfer))),
      ];
      return card(lead, 'เงินสดที่ต้องได้', sub, b);
    }

    case 'transfer': {
      if (!c.hasData) {
        const lead = `${snap.dayLabel} ยังไม่ได้รับไฟล์เงินโอนครับ ` +
                     `ยอดขายทั้งวัน ${baht(s.total)} บาท`;
        return card(lead, 'เงินโอนเข้าบัญชี', sub, [
          kv('ยอดขาย (ปิดวัน)', baht(s.total), '100%'),
          kv('เงินโอนเข้าบัญชี', '—', '—', { strong: true, hot: true }),
          txt('ยังไม่ได้รับไฟล์เงินโอนของวันนี้', 
              { size: 'xxs', color: MUTED, margin: 'md', wrap: true }),
        ]);
      }
      const lead = `วันนี้โอนเข้ามารวม ${baht(c.transfer)} บาทครับ ` +
                   `คิดเป็น ${pct(c.transfer, c.sales)} ของยอดขาย`;
      const b = [
        txt(baht(c.transfer), { size: '3xl', color: RED, weight: 'bold', align: 'center' }),
        txt('บาท', { size: 'xxs', color: MUTED, align: 'center' }),
        sep(), head('แยกรายบัญชี', 'md'),
        ...c.accounts.map((a) => kv(`${a.bank.replace('ธนาคาร', '')} ${a.acc}`,
                                    baht(a.amount), pct(a.amount, c.transfer))),
        sep(),
        txt('ไฟล์ธนาคารไม่มีข้อมูลสาขา จึงแยกรายสาขาไม่ได้',
            { size: 'xxs', color: MUTED, margin: 'md', wrap: true }),
      ];
      return card(lead, 'เงินโอนเข้าบัญชี', sub, b);
    }

    case 'branches': {
      const top = [...s.branches].sort((a, b2) => b2.amount - a.amount)[0];
      const lead = `${snap.dayLabel} สาขาที่ขายดีสุดคือ ${top?.name} ` +
                   `${baht(top?.amount)} บาท (${top?.pct}% ของทั้งร้าน)`;
      const b = [
        txt(baht(s.total), { size: '3xl', color: RED, weight: 'bold', align: 'center' }),
        txt('บาท — รวมทุกสาขา', { size: 'xxs', color: MUTED, align: 'center' }),
        sep(), head('แยกสาขา', 'md'),
        ...s.branches.map((x) => kv(x.name, baht(x.amount), `${x.pct}%`)),
      ];
      return card(lead, 'ยอดขายแยกสาขา', sub, b);
    }

    case 'top': {
      const rows = snap.top.slice(0, 20);
      if (!rows.length) {
        return notice('ยังไม่มีรายงานรายสินค้า', sub, [
          `${snap.dayLabel} ยังไม่ได้รับไฟล์ R06.107 / R06.109`,
          'ยอดรวมรายวันมีแล้ว แต่ยังแยกรายสินค้าไม่ได้',
        ], { hot: true });
      }
      const lead = `ขายดีสุดวันนี้คือ ${rows[0].name} ${rows[0].qty} ` +
                   `= ${baht(rows[0].amount)} บาทครับ`;
      const b = rows.map((x) => rankRow(x.rank, x.name, x.qty, baht(x.amount)));
      return card(lead, `ขายดี ${rows.length} อันดับ`,
                                         `${snap.dayLabel} · เรียงตามยอดเงิน`, b);
    }

    case 'order-list': {
      const left = snap.order.filter(
        (o) => !orders.some((n) => o.name.toLowerCase().includes(n.toLowerCase())));
      if (!left.length) {
        return notice('สั่งครบแล้ว', sub, [
          `สั่งครบทั้ง ${orders.length} รายการแล้ว`,
          orders.join(', '),
        ]);
      }
      const lead = `ยังต้องสั่งอีก ${left.length} รายการครับ` +
                   (orders.length ? ` — สั่งไปแล้ว ${orders.length} ตัว` : '');
      const b = left.slice(0, 20).map(
        (o, i) => rankRow(i + 1, o.name, `@ ${baht(o.price)}`, o.qty_text));
      if (orders.length) {
        b.push(sep(), txt(`สั่งแล้ว: ${orders.join(', ')}`,
                          { size: 'xxs', color: MUTED, margin: 'md', wrap: true }));
      }
      return card(lead, 'ที่ยังต้องสั่ง',
                                         `คิดจากเฉลี่ย 30 วัน (${baht(snap.avg30)}/วัน)`, b);
    }

    case 'help': {
      const cmds = [
        ['ยอดวันนี้', 'ยอดขาย + แยกกะ + แยกสาขา'],
        ['เงินสดวันนี้ต้องได้เท่าไหร่', 'ยอดขาย ลบ เงินโอน'],
        ['โอนเท่าไหร่', 'ยอดโอน แยกรายบัญชี'],
        ['ขายดี', 'อันดับสินค้าของวันนั้น'],
        ['แยกสาขา', 'ยอดขายแต่ละสาขา'],
        ['ต้องสั่งอะไรบ้าง', 'รายการที่ยังไม่ได้สั่ง'],
        ['เศษเนื้อแดงสั่งแล้ว', 'จำไว้ ไม่แนะนำซ้ำ'],
        ['ยกเลิกเศษเนื้อแดง', 'เอากลับเข้ารายการ'],
      ];
      const lead = 'พิมพ์คุยกับผมได้เลยครับ ไม่ต้องมีคำสั่งพิเศษ';
      const b = cmds.flatMap(([c, d], i) => [
        txt(`"${c}"`, { size: 'sm', color: INK, weight: 'bold',
                        margin: i ? 'md' : undefined, wrap: true }),
        txt(d, { size: 'xxs', color: MUTED, wrap: true }),
      ]);
      return card(lead, 'คุยอะไรได้บ้าง', 'พิมพ์เป็นภาษาคนได้เลย', b);
    }

    default:
      return null;
  }
}
