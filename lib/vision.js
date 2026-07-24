// อ่านรายงานนำส่งเงินปิดกะจากรูป (ตัวพิมพ์ + ลายมือ) ด้วย AI vision ผ่าน OpenRouter

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const PROMPT = [
  'รูปนี้เกี่ยวกับการนำส่งเงินปิดกะของร้านค้าไทย อาจเป็น: รายงานสรุปปิดกะ, สลิปโอนเงิน (อาจมีหลายสลิปในรูปเดียว), หรือทั้งสองอย่าง (มีทั้งตัวพิมพ์และลายมือเขียน)',
  'อ่านรูปอย่างละเอียดทีละส่วน แล้วตอบเป็น JSON สั้นๆ เท่านั้น ห้ามมีข้อความอื่น ห้ามใช้ code fence:',
  '{',
  '  "cash_sales": <ยอดขายเงินสด เป็นตัวเลข ถ้าไม่พบ null>,',
  '  "transfer_sales": <ยอดขายโอน เป็นตัวเลข ถ้าไม่พบ null>,',
  '  "epayment": <ยอด E-Payment เป็นตัวเลข ถ้าไม่พบ null>,',
  '  "total": <ยอดรวม เป็นตัวเลข ถ้าไม่พบ null>,',
  '  "deposit": <ยอดเงินฝาก/นำส่งจริง เป็นตัวเลข ถ้าไม่พบ null>,',
  '  "slips": [<สลิปโอนแต่ละใบที่เห็นในรูป เรียงทีละใบ เช่น {"amount": 6000.00, "time": "11:56"} ถ้าไม่มีสลิปให้เป็น []>],',
  '  "doc_no": "<เลขที่เอกสาร ถ้ามี>",',
  '  "date": "<วันที่ในเอกสาร ถ้ามี>",',
  '  "handwritten_note": "<ข้อความลายมือที่เขียนเพิ่ม ถ้ามี สั้นๆ>",',
  '  "success": <true ถ้าอ่านได้>',
  '}',
  'ถ้ามีสลิปหลายใบ ให้แยก amount ของแต่ละใบเป็นคนละรายการใน slips ห้ามเอามาบวกกันเอง',
  'กติกาเรื่องตัวเลข (สำคัญมาก):',
  '- คงจุดทศนิยมตามจริง เช่น "32,399.98" ต้องเป็น 32399.98 ห้ามเป็น 3239998',
  '- "6,000.00" ต้องเป็น 6000 หรือ 6000.00 ห้ามเป็น 600000',
  '- คอมมาคือตัวคั่นหลักพัน ไม่ใช่ทศนิยม / อย่ารวมตัวเลขจากหลายบรรทัดเข้าด้วยกัน',
  '- ยอดเงินต่อกะปกติหลักพันถึงแสน ถ้าได้เกินล้านให้กลับไปอ่านใหม่',
  'ตัวเลขในคำตอบห้ามมีคอมมา ตอบแค่ JSON ก้อนเดียว สั้นที่สุด',
].join('\n');

/**
 * @param {Buffer} imageBuffer
 * @param {string} contentType
 * @param {{apiKey:string, model:string}} opts
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
      max_tokens: 500,
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

/** แกะ JSON จากคำตอบโมเดล — ตัด code fence, กัน JSON ขาด, มี regex สำรองรายฟิลด์ */
export function parseResult(content) {
  const cleaned = content.replace(/```(?:json)?/gi, '').trim();

  let parsed = null;
  const jsonMatch = cleaned.match(/\{[\s\S]*?\}/); // ก้อนแรกแบบสั้นสุด กันขยะต่อท้าย
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    // JSON พัง → ดึงรายฟิลด์ด้วย regex จากข้อความดิบ
    parsed = {
      cash_sales: fieldNumber(cleaned, 'cash_sales'),
      transfer_sales: fieldNumber(cleaned, 'transfer_sales'),
      epayment: fieldNumber(cleaned, 'epayment'),
      total: fieldNumber(cleaned, 'total'),
      deposit: fieldNumber(cleaned, 'deposit'),
      doc_no: fieldString(cleaned, 'doc_no'),
      date: fieldString(cleaned, 'date'),
      handwritten_note: fieldString(cleaned, 'handwritten_note'),
      success: true,
    };
  }

  const cashSales = sanitizeAmount(toNumber(parsed.cash_sales));
  const transferSales = sanitizeAmount(toNumber(parsed.transfer_sales));
  const epayment = sanitizeAmount(toNumber(parsed.epayment));
  const total = sanitizeAmount(toNumber(parsed.total));
  const deposit = sanitizeAmount(toNumber(parsed.deposit));

  // สลิปรายใบ: เช็คตัวเลขทีละใบ แล้วให้โค้ดรวมยอดเอง (ไม่เชื่อยอดรวมจากโมเดล)
  const slipsRaw = Array.isArray(parsed.slips) ? parsed.slips : [];
  const slips = slipsRaw
    .map((s) => {
      const amt = sanitizeAmount(toNumber(s?.amount));
      return amt.value != null
        ? { amount: amt.value, time: strOrNull(s?.time), suspicious: amt.suspicious }
        : null;
    })
    .filter(Boolean);
  const slipsTotal = slips.length
    ? Math.round(slips.reduce((sum, s) => sum + s.amount, 0) * 100) / 100
    : null;

  return {
    cashSales: cashSales.value,
    transferSales: transferSales.value,
    epayment: epayment.value,
    total: total.value,
    deposit: deposit.value,
    slips,
    slipsTotal,
    suspicious: [
      cashSales.suspicious && 'ยอดขายเงินสด',
      transferSales.suspicious && 'ยอดขายโอน',
      epayment.suspicious && 'E-Payment',
      total.suspicious && 'ยอดรวม',
      deposit.suspicious && 'ยอดนำส่ง',
      slips.some((s) => s.suspicious) && 'สลิปบางใบ',
    ].filter(Boolean),
    docNo: strOrNull(parsed.doc_no),
    date: strOrNull(parsed.date),
    note: strOrNull(parsed.handwritten_note),
    success: parsed.success !== false &&
      (parsed.cash_sales != null || parsed.deposit != null || parsed.total != null || slips.length > 0),
    raw: content.slice(0, 500),
  };
}

// ยอดต่อกะไม่ควรเกินล้านบาท — เกินมักแปลว่าจุดทศนิยมหล่น (x100)
const MAX_PLAUSIBLE = 1_000_000;
function sanitizeAmount(n) {
  if (n == null) return { value: null, suspicious: false };
  if (n < MAX_PLAUSIBLE) return { value: n, suspicious: false };
  // ลองกู้เคสทศนิยมหล่น: หาร 100 แล้วดูว่าเข้าเค้าไหม
  const fixed = n / 100;
  if (fixed < MAX_PLAUSIBLE) return { value: fixed, suspicious: true };
  return { value: n, suspicious: true };
}

function fieldNumber(text, name) {
  const m = text.match(new RegExp(`"${name}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`));
  return m ? m[1] : null;
}
function fieldString(text, name) {
  const m = text.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`));
  return m ? m[1] : null;
}
function toNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}
function strOrNull(v) {
  const s = (v ?? '').toString().trim();
  return s && s !== 'null' ? s.slice(0, 200) : null;
}
