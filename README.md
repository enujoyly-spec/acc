# บอทอ่านสลิปในไลน์

LINE OA bot: พนักงานส่ง **รูปสลิปโอน** ในกลุ่มไลน์ → บอทอ่านด้วย AI vision (OpenRouter) → **ตอบสรุปกลับในกลุ่ม** (จำนวนเงิน / เวลา / ผู้โอน / ผู้รับ / เลขอ้างอิง)

ไม่ต้องใช้ Google Sheets, ไม่ต้องพิมพ์คำสั่งอะไร — แค่ส่งรูปสลิป

## โครงสร้าง

```
line-bot/
├─ api/webhook.js   รับ webhook จาก LINE → อ่านสลิป → ตอบกลับ
├─ lib/line.js      ตรวจ signature + ดึงรูป + ตอบข้อความ
├─ lib/vision.js    ส่งรูปให้ OpenRouter อ่านยอด
├─ package.json     (ไม่มี dependency ภายนอก ใช้ fetch ในตัว Node)
└─ .env.example     ตัวแปรที่ต้องตั้ง
```

## Environment Variables (แค่ 2–3 ตัว)

| ชื่อ | ค่า | จำเป็น |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | token จาก LINE (ควรออกใหม่) | ✅ |
| `OPENROUTER_API_KEY` | key `sk-or-...` จาก openrouter.ai | ✅ |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-001` | ✅ (ตั้งไว้แล้ว) |
| `LINE_CHANNEL_SECRET` | Channel secret — ไว้ตรวจว่ามาจาก LINE จริง | ไม่ใส่ก็ได้ |

## ตั้งค่า LINE

- แท็บ **Messaging API**: **Use webhook = เปิด**, **Auto-reply = ปิด**, **Allow bot to join group chats = เปิด**
- Webhook URL (หลัง deploy): `https://<โปรเจกต์>.vercel.app/api/webhook` → กด **Verify** ต้องได้ Success
- เชิญ OA เข้ากลุ่ม แล้วส่งรูปสลิปทดสอบ

## ความปลอดภัย
อย่า commit คีย์จริง — ใช้ Environment Variables บน Vercel เท่านั้น (`.gitignore` กัน `.env` ไว้แล้ว)
