// อ่านรายงาน/เอกสารในรูป (ตัวพิมพ์ + ลายมือ) ด้วย AI vision ผ่าน OpenRouter

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const PROMPT = [
  'รูปนี้เป็นรายงาน/เอกสารเกี่ยวกับการนำส่งเงินปิดกะของร้านค้า (อาจมีทั้งตัวพิมพ์และลายมือเขียน)',
  'อ่านข้อความทั้งหมดในรูปให้ครบถ้วน ทั้งที่พิมพ์และที่เขียนด้วยมือ',
  'แล้วตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON:',
  '{',
  '  "cash_sales": <ยอดขายเงินสดในกะนี้ เป็นตัวเลข ไม่มีคอมมา ถ้าไม่พบให้เป็น null>,',
  '  "deposit": <ยอดเงินที่นำส่ง/ฝากเข้าจริง เป็นตัวเลข ถ้าไม่พบให้เป็น null>,',
  '  "summary": "<สรุปสาระสำคัญของรายงานนี้ สั้นๆ เป็นภาษาไทย>",',
  '  "all_text": "<ข้อความทั้งหมดที่อ่านได้จากรูป จัดบรรทัดตามจริง>",',
  '  "success": <true ถ้าอ่านรูปได้, false ถ้าอ่านไม่ออกหรือไม่ใช่เอกสาร>',
  '}',
].join('\n');

/**
 * @param {Buffer} imageBuffer
 * @param {string} contentType
 * @param {{apiKey:string, model:string}} opts
 * @returns {Promise<{cashSales:number|null, deposit:number|null, summary:string, allText:string, success:boolean, raw:string}>}
 */
export async function readReport(imageBuffer, contentType, { apiKey, model }) {
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
  return parseResult(content);
}

/** ดึง JSON ออกจากคำตอบโมเดล */
export function parseResult(content) {
  let parsed = null;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      /* ตกไป fallback */
    }
  }

  if (parsed) {
    return {
      cashSales: toNumber(parsed.cash_sales),
      deposit: toNumber(parsed.deposit),
      summary: parsed.summary ?? '',
      allText: parsed.all_text ?? '',
      success: parsed.success !== false,
      raw: content,
    };
  }

  // fallback: อ่าน JSON ไม่ได้ ใช้ข้อความดิบเป็นสรุป
  return {
    cashSales: null,
    deposit: null,
    summary: content.trim().slice(0, 800),
    allText: content.trim(),
    success: content.trim().length > 0,
    raw: content,
  };
}

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}
