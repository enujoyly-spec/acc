// ตัวช่วยฝั่งบอท: อ่านสรุปยอดที่ mangmee.py สร้างไว้ + จำว่าของอะไรสั่งไปแล้ว
//
// data.json ถูก build ที่เครื่องร้านแล้ว push ขึ้นมาพร้อมหน้าเว็บ (public/mangmee/data.json)
// ส่วน "สั่งแล้ว" ผู้ใช้พิมพ์ในไลน์ จึงต้องเก็บฝั่งนี้ — ใช้ Vercel Blob ตัวเดียวกับบอทสลิป
import { get, put } from '@vercel/blob';

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

/**
 * ตีความข้อความไทยแบบสั้นๆ ด้วยคำสำคัญ — ไม่ต้องพึ่ง LLM สำหรับคำถามที่ถามบ่อย
 * คืน null ถ้าไม่เข้าเคสไหนเลย (ให้ผู้เรียกไปต่อด้วย LLM)
 */
export function routeText(text) {
  const t = (text || '').trim();
  if (!t) return null;

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

export function answer(kind, snap, orders) {
  const s = snap.sales, c = snap.cash;
  switch (kind) {
    case 'sales': {
      const L = [`📋 ${snap.shop} ${snap.dayLabel}`,
                 `ยอดขาย ${baht(s.total)} บาท`];
      if (s.hasShift) L.push(`· กะเช้า ${baht(s.am)} · กะบ่าย ${baht(s.pm)}`);
      L.push(`เทียบเฉลี่ย 30 วัน (${baht(snap.avg30)}/วัน) ` +
             `${s.total >= snap.avg30 ? '▲' : '▼'} ` +
             `${(Math.abs(s.total - snap.avg30) / snap.avg30 * 100).toFixed(1)}%`);
      return L.join('\n');
    }
    case 'cash':
      if (!c.hasData) {
        return `${snap.dayLabel} ยังไม่มีไฟล์เงินโอนของวันนี้ จึงบอกยอดเงินสดไม่ได้\n` +
               `ยอดขายทั้งวัน ${baht(s.total)} บาท — ถ้าอัปไฟล์ธนาคารเข้าระบบแล้วจะคำนวณให้ทันที`;
      }
      return [`💰 เงินสดที่ต้องได้ ${snap.dayLabel}`,
              `ยอดขาย ${baht(c.sales)}`,
              `หักโอน ${baht(c.transfer)} (${Math.round(c.transfer / c.sales * 100)}%)`,
              `= เงินสด ${baht(c.cash)} บาท`].join('\n');
    case 'transfer':
      if (!c.hasData) return `${snap.dayLabel} ยังไม่มีข้อมูลเงินโอน`;
      return [`🏦 เงินโอน ${snap.dayLabel} รวม ${baht(c.transfer)} บาท`,
              ...c.accounts.map((a) => `· ${a.bank.replace('ธนาคาร', '')} ${a.acc} = ${baht(a.amount)}`)].join('\n');
    case 'branches':
      return [`🏪 แยกสาขา ${snap.dayLabel}`,
              ...s.branches.map((b) => `· ${b.name} ${baht(b.amount)} (${b.pct}%)`)].join('\n');
    case 'top':
      return [`🏆 ขายดี ${snap.dayLabel}`,
              ...snap.top.slice(0, 10).map((x) => `${x.rank}. ${x.name} ${x.qty} = ${baht(x.amount)}`)].join('\n');
    case 'order-list': {
      const left = snap.order.filter(
        (o) => !orders.some((n) => o.name.toLowerCase().includes(n.toLowerCase())));
      const L = ['🛒 ที่ยังต้องสั่ง',
                 ...left.slice(0, 20).map((o, i) => `${i + 1}. ${o.name} ≈ ${o.qty_text}`)];
      if (orders.length) L.push('', `สั่งแล้ว ${orders.length} ตัว: ${orders.join(', ')}`);
      return L.join('\n');
    }
    case 'help':
      return ['พิมพ์คุยกับผมได้เลยครับ',
              '· "ยอดวันนี้" — ยอดขาย + เทียบเฉลี่ย',
              '· "เงินสดวันนี้ต้องได้เท่าไหร่"',
              '· "โอนเท่าไหร่" — แยกรายบัญชี',
              '· "ขายดี" · "แยกสาขา"',
              '· "ต้องสั่งอะไรบ้าง"',
              '· "เศษเนื้อแดงสั่งแล้ว" — จำไว้ ไม่แนะนำซ้ำ',
              '· "ยกเลิกเศษเนื้อแดง" — เอากลับเข้ารายการ'].join('\n');
    default:
      return null;
  }
}
