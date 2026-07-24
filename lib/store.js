// เก็บรายงานที่อ่านได้ระหว่างวันลง Vercel Blob (REST API ตรงๆ ไม่ต้องลง dependency)
// ต้องเปิด Blob store ในหน้า Vercel: Storage → Blob → Create → Connect Project
// แล้วระบบจะใส่ BLOB_READ_WRITE_TOKEN ให้เอง

const API = 'https://blob.vercel-storage.com';

function token() {
  return process.env.BLOB_READ_WRITE_TOKEN || '';
}

export function storeReady() {
  return Boolean(token());
}

/** โหลดรายการรายงานของวันนั้น (array) — ไม่มีไฟล์ = [] */
export async function loadDay(dateKey) {
  const res = await fetch(`${API}?prefix=reports/${dateKey}.json&limit=1`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`Blob list HTTP ${res.status}`);
  const data = await res.json();
  const blob = (data.blobs || [])[0];
  if (!blob?.url) return [];
  // กัน cache: ใส่ query กันค่าเก่า
  const r = await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) return [];
  try {
    const arr = await r.json();
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** เขียนทับรายการของวันนั้นทั้งก้อน */
export async function saveDay(dateKey, records) {
  const res = await fetch(`${API}/reports/${dateKey}.json`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token()}`,
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '0',
    },
    body: JSON.stringify(records),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Blob put HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
}

/** เพิ่มรายงาน 1 รายการเข้าไฟล์ของวันนั้น (อ่าน-เติม-เขียนทับ) */
export async function appendReport(dateKey, record) {
  const records = await loadDay(dateKey);
  records.push(record);
  await saveDay(dateKey, records);
  return records.length;
}

/** จำ groupId ล่าสุดที่บอทเห็น (ใช้เป็นปลายทางแจ้งเตือนอัตโนมัติ) */
export async function saveGroupId(groupId) {
  if (!groupId) return;
  await fetch(`${API}/meta.json`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token()}`,
      'x-content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-cache-control-max-age': '0',
    },
    body: JSON.stringify({ groupId }),
  });
}

export async function loadGroupId() {
  const res = await fetch(`${API}?prefix=meta.json&limit=1`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const blob = (data.blobs || [])[0];
  if (!blob?.url) return null;
  const r = await fetch(`${blob.url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) return null;
  try {
    return (await r.json())?.groupId || null;
  } catch {
    return null;
  }
}
