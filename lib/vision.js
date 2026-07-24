// อ่านสลิปโอนเงินด้วย AI vision ผ่าน OpenRouter (OpenAI-compatible API)

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const PROMPT = [
  'นี่คือรูปสลิปโอนเงินของธนาคารไทย',
  'ดึงข้อมูลต่อไปนี้แล้วตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:',
  '{',
  '  "amount": <จำนวนเงินที่โอน เป็นตัวเลข ไม่มีคอมมา ไม่มีสัญลักษณ์>,',
  '  "datetime": "<วันเวลาที่โอน ถ้ามี ไม่มีให้เป็น null>",',
  '  "sender": "<ชื่อผู้โอน ถ้ามี>",',
  '  "receiver": "<ชื่อผู้รับ ถ้ามี>",',
  '  "ref": "<เลขอ้างอิง/รหัสรายการ ถ้ามี>",',
  '  "success": <true ถ้าเป็นสลิปโอนสำเร็จ, false ถ้าอ่านไม่ออกหรือไม่ใช่สลิป>',
  '}',
  'ถ้าอ่านจำนวนเงินไม่ได้ ให้ amount เป็น null และ success เป็น false',
].join('\n');

/**
 * @param {Buffer} imageBuffer
 * @param {string} contentType เช่น "image/jpeg"
 * @param {{apiKey:string, model:string}} opts
 * @returns {Promise<{amount:number|null, datetime?:string, sender?:string, receiver?:string, ref?:string, success:boolean, raw:string}>}
 */
export async function readSlip(imageBuffer, contentType, { apiKey, model }) {
  const dataUri = `data:${contentType};base64,${imageBuffer.toString('base64')}`;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'store-cash-bot',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`OpenRouter HTTP ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return parseSlipResult(content);
}

/** ดึง JSON ออกจากคำตอบโมเดล + fallback หาเลขจำนวนเงินถ้า JSON พัง */
export function parseSlipResult(content) {
  let parsed = null;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      /* ตกไป fallback ด้านล่าง */
    }
  }

  if (parsed && parsed.amount != null) {
    const amount = toNumber(parsed.amount);
    return {
      amount,
      datetime: parsed.datetime ?? null,
      sender: parsed.sender ?? null,
      receiver: parsed.receiver ?? null,
      ref: parsed.ref ?? null,
      success: amount != null && parsed.success !== false,
      raw: content,
    };
  }

  // fallback: หาเลขก้อนแรกที่ดูเป็นจำนวนเงิน
  const m = content.match(/([0-9][0-9,]*\.?[0-9]*)/);
  const amount = m ? toNumber(m[1]) : null;
  return { amount, success: amount != null, raw: content };
}

function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}
