// เชื่อม Google Sheets ด้วย service account (JWT)
import { google } from 'googleapis';

export const MAIN_TAB = 'บันทึกประจำวัน';
export const PENDING_TAB = 'สลิปรอจับคู่';

const MAIN_HEADER = [
  'วันที่', 'สาขา', 'กะ', 'พนักงาน', 'ยอดขาย POS', 'เงินสด',
  'เงินโอน(รวม)', 'รวมรับจริง', 'ผลต่าง', 'สถานะ', 'จำนวนสลิป', 'หมายเหตุ', 'เวลาบันทึก',
];
const PENDING_HEADER = [
  'epochMs', 'userId', 'groupId', 'จำนวนเงิน', 'messageId', 'datetime', 'ผู้โอน', 'ref', 'ใช้แล้ว',
];

let _sheets = null;

function getClient() {
  if (_sheets) return _sheets;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('ยังไม่ได้ตั้ง GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY');
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('ยังไม่ได้ตั้ง GOOGLE_SHEET_ID');
  return id;
}

const q = (tab) => `'${tab.replace(/'/g, "''")}'`;

/** สร้างแท็บ + หัวตาราง ถ้ายังไม่มี (เรียกได้บ่อย ปลอดภัย) */
export async function ensureSetup() {
  const sheets = getClient();
  const spreadsheetId = sheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const titles = new Set((meta.data.sheets || []).map((s) => s.properties.title));

  const toAdd = [];
  if (!titles.has(MAIN_TAB)) toAdd.push(MAIN_TAB);
  if (!titles.has(PENDING_TAB)) toAdd.push(PENDING_TAB);

  if (toAdd.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: toAdd.map((title) => ({ addSheet: { properties: { title } } })) },
    });
    for (const title of toAdd) {
      const header = title === MAIN_TAB ? MAIN_HEADER : PENDING_HEADER;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${q(title)}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [header] },
      });
    }
  }
}

/** เก็บสลิป 1 ใบเข้าคิวรอจับคู่ */
export async function appendPending(entry) {
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${q(PENDING_TAB)}!A:I`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        entry.epochMs, entry.userId, entry.groupId, entry.amount,
        entry.messageId, entry.datetime ?? '', entry.sender ?? '', entry.ref ?? '', '',
      ]],
    },
  });
}

/** ดึงสลิปของ user ที่ยังไม่ถูกใช้ และเกิดหลัง sinceMs */
export async function getUnconsumedPending(userId, groupId, sinceMs) {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${q(PENDING_TAB)}!A2:I`,
  });
  const rows = res.data.values || [];
  const out = [];
  rows.forEach((r, i) => {
    const epochMs = Number(r[0]);
    const rUser = r[1];
    const rGroup = r[2];
    const amount = parseFloat(String(r[3] ?? '').replace(/,/g, ''));
    const consumed = r[8];
    if (rUser === userId && (!groupId || rGroup === groupId) &&
        !consumed && Number.isFinite(epochMs) && epochMs >= sinceMs && Number.isFinite(amount)) {
      out.push({ rowNumber: i + 2, amount });
    }
  });
  return out;
}

/** ทำเครื่องหมายว่าสลิปถูกใช้แล้ว (คอลัมน์ I) */
export async function markConsumed(rowNumbers) {
  if (!rowNumbers.length) return;
  const sheets = getClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      valueInputOption: 'RAW',
      data: rowNumbers.map((n) => ({ range: `${q(PENDING_TAB)}!I${n}`, values: [['x']] })),
    },
  });
}

/** บันทึกแถวสรุป 1 รายการลงตารางหลัก */
export async function appendMainRow(row) {
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${q(MAIN_TAB)}!A:M`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}
