// เก็บรายงานที่อ่านได้ระหว่างวันลง Vercel Blob (store แบบ Private) ผ่าน SDK ทางการ
// ต้องเปิด Blob store ในหน้า Vercel: Storage → Blob → Connect Project
// แล้วระบบจะใส่ BLOB_READ_WRITE_TOKEN ให้เอง
import { get, put } from '@vercel/blob';

export function storeReady() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readJson(pathname) {
  try {
    // useCache: false = อ่านค่าล่าสุดเสมอ (สำคัญกับ read-modify-write)
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

/** โหลดรายการรายงานของวันนั้น (array) — ไม่มีไฟล์ = [] */
export async function loadDay(dateKey) {
  const v = await readJson(`reports/${dateKey}.json`);
  return Array.isArray(v) ? v : [];
}

/** เขียนทับรายการของวันนั้นทั้งก้อน */
export async function saveDay(dateKey, records) {
  await writeJson(`reports/${dateKey}.json`, records);
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
  await writeJson('meta.json', { groupId });
}

export async function loadGroupId() {
  const v = await readJson('meta.json');
  return v?.groupId || null;
}
