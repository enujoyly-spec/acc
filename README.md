# บอทตรวจเงินร้าน (LINE OA → Google Sheets)

บอท LINE Official Account รับสลิปโอน + ยอด POS ที่พนักงานส่งในกลุ่มไลน์ อ่านยอดโอนจากสลิปด้วย AI vision (OpenRouter) กระทบยอดกับเงินสด+POS แล้วบันทึกลง Google Sheets โดยอัตโนมัติ (บันทึกอย่างเดียว ไม่ตอบในกลุ่ม)

## รูปแบบข้อความที่พนักงานพิมพ์

พิมพ์ข้อความนี้ในกลุ่ม แล้ว**ส่งรูปสลิปโอนตามมา** (ส่งได้หลายรูปถ้าโอนหลายครั้ง):

```
#ตรวจเงิน
สาขา: หนองดอก
กะ: เช้า
เงินสด: 8200
POS: 15000
```

- สาขา: หนองดอก / จอมทอง / บ้านเส้ง
- กะ: เช้า / บ่าย
- บอทจะจับคู่สลิปที่ผู้ส่งคนเดียวกันส่งภายใน `PENDING_WINDOW_MIN` นาทีก่อนหน้า มารวมเป็นยอดโอน

## โครงสร้างโปรเจกต์

```
line-bot/
├─ api/webhook.js      จุดรับ webhook จาก LINE (Vercel serverless)  ✅
├─ lib/parse.js        แปลงข้อความ #ตรวจเงิน                        ✅
├─ lib/reconcile.js    คำนวณ ตรง/ขาด/เกิน                          ✅
├─ lib/line.js         ตรวจ signature + ดึงรูปสลิป + ชื่อผู้ส่ง       ✅
├─ lib/vision.js       ส่งรูปให้ OpenRouter อ่านยอด                 ✅
├─ lib/sheets.js       สร้างแท็บ + เขียนแถวลง Google Sheets         ✅
├─ vercel.json         ตั้งค่า timeout ของ function                 ✅
├─ package.json        dependency (googleapis)                     ✅
├─ .env.example        รายการตัวแปรลับที่ต้องตั้ง                     ✅
└─ .gitignore          กัน .env และคีย์หลุด                          ✅
```

โค้ด**เขียนครบแล้ว** แต่ยัง**ไม่เคยรันจริง** (เครื่องนี้ไม่มี Node) — ต้อง deploy แล้วทดสอบในกลุ่มจริง จุดที่ต้องเช็กก่อนเป็นอันดับแรกคือ **signature/raw body** บน Vercel (ดูขั้นตอนที่ 5)

## How it works

1. พนักงานส่ง **รูปสลิป** ในกลุ่ม → บอทอ่านยอดด้วย OpenRouter → เก็บเข้าแท็บ `สลิปรอจับคู่`
2. พนักงานพิมพ์ **`#ตรวจเงิน` + สาขา/กะ/เงินสด/POS** → บอทรวมยอดสลิปของคนนั้นในช่วง `PENDING_WINDOW_MIN` นาที → คำนวณ → เขียนแถวลงแท็บ `บันทึกประจำวัน` → ทำเครื่องหมายสลิปว่าใช้แล้ว
3. บอท **ไม่ตอบในกลุ่ม** (บันทึกเงียบๆ อย่างเดียว) — ชื่อพนักงานดึงจากชื่อ LINE ของผู้ส่งอัตโนมัติ

> แท็บ `บันทึกประจำวัน` และ `สลิปรอจับคู่` บอทจะสร้างให้เองครั้งแรกที่ทำงาน — คุณแค่มีไฟล์ Sheet เปล่าๆ ก็พอ

## ขั้นตอน Deploy (เรียงลำดับ)

1. **ออกคีย์ใหม่ทั้ง 2 ตัว** (LINE token + OpenRouter key) แล้วเก็บ Channel secret ด้วย
2. **Google:** สร้าง Sheet เปล่า + Service Account (JSON) + เปิด Sheets API + **แชร์ Sheet ให้อีเมล service account (Editor)**
3. push โฟลเดอร์ `line-bot/` ขึ้น **GitHub** → import เข้า **Vercel** (ตั้ง Root Directory = `line-bot`)
4. ที่ Vercel ใส่ **Environment Variables** ครบตาม `.env.example` แล้ว Deploy → ได้ URL
5. เอา **`https://<โปรเจกต์>.vercel.app/api/webhook`** ไปใส่เป็น Webhook URL ใน LINE → กด **Verify** (ต้องได้ Success = signature ผ่าน)
6. เชิญ LINE OA เข้ากลุ่มร้าน → ส่งข้อความอะไรก็ได้ 1 ที → ดู **Vercel Logs** จะเห็น `groupId` → เอาไปใส่ `ALLOWED_GROUP_ID` (กันบอทไปทำงานกลุ่มอื่น) แล้ว redeploy
7. ทดสอบ: ส่งสลิป + `#ตรวจเงิน` ในกลุ่ม → เช็กว่าแถวขึ้นใน Google Sheet

## สิ่งที่ต้องเตรียม (ผู้ใช้ทำเอง — เป็นความลับ)

### 1) LINE Messaging API
- LINE Developers Console → Channel (ID 2010826069)
- **Reissue Channel access token** (ตัวเก่าหลุดแล้ว) → เก็บไว้ใส่ `LINE_CHANNEL_ACCESS_TOKEN`
- คัดลอก **Channel secret** → `LINE_CHANNEL_SECRET`
- ตั้งค่า: **Use webhook = เปิด**, **Auto-reply = ปิด**, **Allow bot to join group chats = เปิด**
- Webhook URL จะได้หลัง deploy Vercel: `https://<โปรเจกต์>.vercel.app/api/webhook`

### 2) OpenRouter (AI vision)
- openrouter.ai → สร้าง API key ใหม่ (ตัวเก่าหลุดแล้ว) → `OPENROUTER_API_KEY`
- เลือกโมเดล vision ราคาถูก เช่น `google/gemini-2.0-flash-001` → `OPENROUTER_MODEL`

### 3) Google Sheets
- สร้าง Google Sheet ใหม่ 1 ไฟล์ → คัดลอก **Sheet ID** จาก URL → `GOOGLE_SHEET_ID`
- Google Cloud Console → สร้าง **Service Account** → สร้าง JSON key
  - เอา `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
  - เอา `private_key` → `GOOGLE_PRIVATE_KEY`
- เปิดใช้ **Google Sheets API** ในโปรเจกต์
- **แชร์ Google Sheet ให้อีเมล service account** (สิทธิ์ Editor) ← ลืมขั้นนี้บ่อย

### 4) Vercel (host ฟรี)
- push โฟลเดอร์นี้ขึ้น GitHub → เชื่อมกับ vercel.com
- ใส่ตัวแปรทั้งหมดจาก `.env.example` ที่ Project Settings → Environment Variables
- Deploy → เอา URL ไปใส่เป็น Webhook URL ใน LINE

## หมายเหตุความปลอดภัย
อย่าใส่คีย์จริงลงในโค้ดหรือ commit ขึ้น git — ใช้ `.env` (ในเครื่อง) และ Environment Variables (บน Vercel) เท่านั้น ไฟล์ `.gitignore` กันไว้ให้แล้ว
