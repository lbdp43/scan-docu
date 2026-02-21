const Tesseract = require('tesseract.js');

const LANG = process.env.TESSERACT_LANG || 'fra+eng';

// Merchant type detection dictionary
const TYPE_KEYWORDS = {
  carburant: [
    'total', 'totalenergies', 'total energies', 'bp', 'esso', 'shell',
    'avia', 'leclerc drive', 'carrefour market', 'intermarche',
    'super u', 'station', 'gasoil', 'gazole', 'sans plomb',
    'sp95', 'sp98', 'e10', 'e85', 'diesel', 'carburant', 'litre',
    'pompe', 'fuel',
  ],
  repas: [
    'restaurant', 'bistrot', 'brasserie', 'café', 'cafe', 'bar',
    'pizzeria', 'burger', 'mcdo', 'mcdonald', 'kfc', 'subway',
    'sushi', 'kebab', 'traiteur', 'boulangerie', 'patisserie',
    'repas', 'menu', 'plat', 'dessert', 'entrée', 'boisson',
    'couvert', 'service',
  ],
  peage: [
    'peage', 'péage', 'autoroute', 'vinci', 'aprr', 'sanef',
    'area', 'asr', 'atlandes', 'cofiroute', 'escota',
    'toll', 'barrier', 'section',
  ],
};

function detectType(text) {
  const lower = text.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return type;
      }
    }
  }
  return 'autre';
}

function extractAmount(text) {
  // Match patterns like: 67,40 € / 67.40 EUR / TOTAL 67.40 / 12,50€
  const patterns = [
    /(\d+[.,]\d{2})\s*(?:€|EUR|eur)/gi,
    /(?:total|montant|net|ttc|a payer|à payer)\s*:?\s*(\d+[.,]\d{2})/gi,
    /(\d+[.,]\d{2})\s*$/gm,
  ];

  const amounts = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const amount = parseFloat(match[1].replace(',', '.'));
      if (amount > 0 && amount < 10000) {
        amounts.push(amount);
      }
    }
  }

  if (amounts.length === 0) return null;
  // Return the largest amount (likely the total)
  return Math.max(...amounts);
}

function extractDate(text) {
  // DD/MM/YYYY or DD-MM-YYYY
  const datePatterns = [
    /(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/,
    /(\d{2})[\/\-.](\d{2})[\/\-.](\d{2})/,
    /(?:le\s+)?(\d{1,2})\s+(?:jan|fév|fev|mar|avr|mai|juin|juil|jul|aoû|aou|sep|oct|nov|déc|dec)[a-z]*\.?\s+(\d{4})/i,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[3] && match[3].length === 4) {
        // DD/MM/YYYY
        const day = parseInt(match[1]);
        const month = parseInt(match[2]);
        const year = parseInt(match[3]);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      } else if (match[3] && match[3].length === 2) {
        // DD/MM/YY
        const day = parseInt(match[1]);
        const month = parseInt(match[2]);
        const year = 2000 + parseInt(match[3]);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }
  }

  // Fallback: today's date
  return new Date().toISOString().slice(0, 10);
}

function extractMerchant(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
  // First non-numeric meaningful line is likely the merchant name
  for (const line of lines.slice(0, 5)) {
    // Skip lines that are mostly numbers or very short
    if (!/^\d+/.test(line) && line.length > 3 && line.length < 60) {
      return line;
    }
  }
  return null;
}

function extractDescription(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
  // Look for product description lines
  for (const line of lines) {
    if (/article|produit|designation|libellé/i.test(line)) {
      return line;
    }
  }
  return null;
}

async function performOCR(imageBuffer) {
  console.log('[ocr] Starting Tesseract with lang:', LANG);
  const worker = await Tesseract.createWorker(LANG);

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '4', // Single column of text (better for receipts)
      tessedit_ocr_engine_mode: '3', // LSTM neural net
      preserve_interword_spaces: '1', // Keep spacing for amounts
    });

    const { data } = await worker.recognize(imageBuffer);
    const rawText = data.text;
    const confidence = data.confidence;

    console.log(`[ocr] Confidence: ${confidence}%, text length: ${rawText.length}`);
    console.log('[ocr] Raw text (first 300 chars):', rawText.substring(0, 300));

    const extracted = {
      amount: extractAmount(rawText),
      date: extractDate(rawText),
      merchant: extractMerchant(rawText),
      type: detectType(rawText),
      description: extractDescription(rawText),
    };

    console.log('[ocr] Extracted:', JSON.stringify(extracted));

    return { rawText, extracted, confidence };
  } finally {
    await worker.terminate();
  }
}

module.exports = { performOCR };
