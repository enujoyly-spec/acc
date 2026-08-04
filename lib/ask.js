// ถามอะไรก็ได้ — ส่งข้อมูลสรุปของวันให้ AI ตอบ เมื่อ routeText() จับคำสั่งไม่ได้
// ใช้ OpenRouter ตัวเดียวกับที่อ่านสลิป (lib/vision.js)
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** ย่อ snapshot ให้เหลือเท่าที่จำเป็น — ส่งทั้งก้อนเปลืองโทเคนและทำให้โมเดลหลง */
function context(snap, orders) {
  const s = snap.sales, c = snap.cash;
  return {
    ร้าน: snap.shop,
    วันที่ข้อมูล: snap.dayLabel,
    ข้อมูลอัปเดตเมื่อ: snap.generated,
    ยอดขายทั้งวัน: s.total,
    เฉลี่ย30วัน: snap.avg30,
    แยกกะ: s.hasShift ? { กะเช้า: s.am, กะบ่าย: s.pm } : 'วันนี้แยกกะไม่ได้',
    แยกสาขา: s.branches.map((b) => `${b.name} ${b.amount} (${b.pct}%)`),
    เงินโอน: c.hasData ? c.transfer : 'ยังไม่มีไฟล์เงินโอนของวันนี้',
    เงินสดที่ต้องได้: c.hasData ? c.cash : 'คำนวณไม่ได้ เพราะยังไม่มีไฟล์เงินโอน',
    บัญชีที่โอนเข้า: c.hasData
      ? c.accounts.map((a) => `${a.bank} ${a.acc} = ${a.amount}`) : [],
    ขายดี: snap.top.slice(0, 20).map((t) => `${t.rank}. ${t.name} ${t.qty} = ${t.amount}`),
    ของที่ควรสั่งพรุ่งนี้: snap.order.slice(0, 20)
      .map((o) => `${o.name} ${o.qty_text} @ ${o.price}`),
    ของที่แจ้งว่าสั่งแล้ววันนี้: orders,
    // ประวัติรายวันทั้งช่วง — ไว้ตอบคำถามอย่าง "วันที่ 1 ขายเท่าไหร่"
    ยอดย้อนหลังรายวัน: (snap.days || []).map((d) =>
      `${d.label} (${d.date}): ขาย ${d.total}` +
      (d.hasShift ? `, เช้า ${d.am}, บ่าย ${d.pm}` : '') +
      (d.transfer === null ? ', ไม่มีข้อมูลโอน'
        : `, โอน ${d.transfer}, เงินสด ${d.cash}`) +
      `, ${Object.entries(d.branches).map(([n, v]) => `${n} ${v}`).join(' ')}`),
  };
}

const SYSTEM = [
  'คุณคือผู้ช่วยของร้านมั่งมีฟู้ดส์ (ร้านขายเนื้อสด 3 สาขา) คุยกับเจ้าของร้านในไลน์',
  'ตอบสั้น กระชับ เป็นภาษาไทยแบบคุยกัน ไม่ต้องทักทายยาว ไม่ต้องใส่ตารางหรือ markdown',
  '',
  'กติกาสำคัญ:',
  '- ตอบจากข้อมูลที่ให้ไปเท่านั้น ห้ามเดาตัวเลขเอง',
  '- ถ้าถามถึงวันใดวันหนึ่ง ให้ดูใน "ยอดย้อนหลังรายวัน" — มีทั้งช่วงให้แล้ว',
  '- บวก/ลบ/เทียบวันต่อวันจากตัวเลขที่ให้ได้ แต่ห้ามสร้างตัวเลขที่ไม่มีในข้อมูล',
  '- ถ้าข้อมูลที่ถามไม่มีอยู่ ให้บอกตรงๆ ว่ายังไม่มี และบอกว่าต้องทำอะไรถึงจะมี',
  '- ตัวเลขเงินให้ใส่คอมมาหลักพัน และลงท้ายว่า บาท',
  '- เงินสดที่ต้องได้ = ยอดขาย − เงินโอน (ถ้ายังไม่มีไฟล์โอน ให้บอกว่าคำนวณไม่ได้)',
  '- เงินโอนแยกรายสาขาไม่ได้ เพราะไฟล์ธนาคารไม่มีข้อมูลสาขา ถ้าถามให้บอกตามนี้',
  '',
  'ถ้าผู้ใช้กำลังบอกว่า "สั่งของบางอย่างไปแล้ว" หรือ "ยกเลิกที่เคยบอกว่าสั่ง"',
  'ให้ตอบเป็น JSON ก้อนเดียวเท่านั้น ห้ามมีข้อความอื่น:',
  '{"action":"order-add","name":"ชื่อสินค้า"} หรือ {"action":"order-del","name":"ชื่อสินค้า"}',
  'นอกนั้นให้ตอบเป็นข้อความธรรมดา ไม่ต้องเป็น JSON',
].join('\n');

/**
 * @returns {Promise<{reply?:string, action?:string, name?:string}>}
 */
export async function ask(question, snap, orders, { apiKey, model }) {
  if (!apiKey) return { reply: null };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'mangmee-bot',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `ข้อมูลวันนี้:\n${JSON.stringify(context(snap, orders), null, 1)}\n\n` +
                   `คำถาม: ${question}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}`);

  const j = await res.json();
  const text = (j?.choices?.[0]?.message?.content || '').trim();
  if (!text) return { reply: null };

  // โมเดลอาจห่อ JSON ด้วย code fence — ลอกออกก่อนลองอ่าน
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  if (clean.startsWith('{')) {
    try {
      const o = JSON.parse(clean);
      if (o?.action === 'order-add' || o?.action === 'order-del') {
        return { action: o.action, name: String(o.name || '').trim() };
      }
    } catch { /* ไม่ใช่ JSON ก็ถือเป็นข้อความปกติ */ }
  }
  return { reply: text };
}
