const Tesseract = require('tesseract.js');

const LANG = process.env.TESSERACT_LANG || 'fra+eng';

// Merchant type detection dictionary
const TYPE_KEYWORDS = {
  carburant: [
    'total', 'totalenergies', 'total energies', 'bp', 'esso', 'shell',
    'avia', 'leclerc drive', 'carrefour market', 'intermarche',
    'super u', 'station', 'gasoil', 'gazole', 'sans plomb',
    'sp95', 'sp98', 'e10', 'e85', 'diesel', 'carburant', 'litre',
    'pompe', 'fuel', 'neste', 'engie',
  ],
  repas: [
    'restaurant', 'bistrot', 'brasserie', 'café', 'cafe', 'bar',
    'pizzeria', 'burger', 'mcdo', 'mcdonald', 'kfc', 'subway',
    'sushi', 'kebab', 'traiteur', 'boulangerie', 'patisserie',
    'repas', 'menu', 'plat', 'dessert', 'entrée', 'boisson',
    'couvert', 'service', 'table', 'addition', 'pourboire',
    'flunch', 'buffalo', 'hippopotamus', 'leon', 'paul',
    'del arte', 'courtepaille', 'quick',
  ],
  peage: [
    'peage', 'péage', 'autoroute', 'vinci', 'aprr', 'sanef',
    'area', 'asr', 'atlandes', 'cofiroute', 'escota',
    'toll', 'barrier', 'section', 'classe', 'gare de',
    'trajet', 'sortie', 'entrée a',
  ],
};

function detectType(text) {
  const lower = text.toLowerCase();
  const scores = { carburant: 0, repas: 0, peage: 0 };
  const matches = { carburant: [], repas: [], peage: [] };

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        scores[type]++;
        matches[type].push(kw);
      }
    }
  }

  // Return the type with the most keyword hits
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const detectedType = best[1] > 0 ? best[0] : 'autre';

  return { type: detectedType, scores, matches };
}

function extractAmount(text) {
  const amounts = [];

  // Pattern 1: Amount with € symbol — "67,40 €" / "67.40€" / "67,40EUR"
  const euroPattern = /(\d+[.,]\d{2})\s*(?:€|EUR|eur)/gi;
  let match;
  while ((match = euroPattern.exec(text)) !== null) {
    const val = parseFloat(match[1].replace(',', '.'));
    if (val > 0 && val < 10000) amounts.push({ val, priority: 1 });
  }

  // Pattern 2: "TOTAL" / "A PAYER" / "NET" / "TTC" / "CB" lines
  const totalPattern = /(?:total|montant|net\s+a|ttc|a\s*payer|à\s*payer|carte|cb\s*[*:]?|reglement)\s*:?\s*(\d+[.,]\d{2})/gi;
  while ((match = totalPattern.exec(text)) !== null) {
    const val = parseFloat(match[1].replace(',', '.'));
    if (val > 0 && val < 10000) amounts.push({ val, priority: 3 });
  }

  // Pattern 3: Amount at end of line (lower priority)
  const lineEndPattern = /(\d+[.,]\d{2})\s*$/gm;
  while ((match = lineEndPattern.exec(text)) !== null) {
    const val = parseFloat(match[1].replace(',', '.'));
    if (val > 0.5 && val < 10000) amounts.push({ val, priority: 0 });
  }

  if (amounts.length === 0) return null;

  // Prefer amounts from "TOTAL/CB" lines, then € amounts, then line-end
  const bestPriority = Math.max(...amounts.map(a => a.priority));
  const topAmounts = amounts.filter(a => a.priority === bestPriority);

  // Return the largest amount at the best priority level (likely the total)
  return Math.max(...topAmounts.map(a => a.val));
}

function extractDate(text) {
  // Pattern 1: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const fullDate = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (fullDate) {
    const day = parseInt(fullDate[1]);
    const month = parseInt(fullDate[2]);
    const year = parseInt(fullDate[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2030) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Pattern 2: DD/MM/YY
  const shortDate = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})(?!\d)/);
  if (shortDate) {
    const day = parseInt(shortDate[1]);
    const month = parseInt(shortDate[2]);
    const year = 2000 + parseInt(shortDate[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2020 && year <= 2030) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Pattern 3: French month names — "21 février 2026" / "21 fev 2026" / "21 fév. 2026"
  const monthMap = {
    jan: 1, fev: 2, fév: 2, mar: 3, avr: 4, mai: 5, juin: 6,
    juil: 7, jul: 7, aou: 8, aoû: 8, sep: 9, oct: 10, nov: 11, dec: 12, déc: 12,
  };
  const frenchDate = text.match(/(\d{1,2})\s+(jan|fév|fev|mar|avr|mai|juin|juil|jul|aoû|aou|sep|oct|nov|déc|dec)[a-zéû]*\.?\s+(\d{4})/i);
  if (frenchDate) {
    const day = parseInt(frenchDate[1]);
    const monthKey = frenchDate[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, 3);
    const month = monthMap[monthKey] || monthMap[frenchDate[2].toLowerCase().substring(0, 3)];
    const year = parseInt(frenchDate[3]);
    if (day >= 1 && day <= 31 && month && year >= 2020 && year <= 2030) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Fallback: today's date
  return new Date().toISOString().slice(0, 10);
}

// Lines to skip when looking for merchant name
const NOISE_PATTERNS = [
  /^\d{2}[\/\-.]/, // Date lines
  /^\d+[.,]\d{2}/, // Amount lines
  /^(tel|fax|tél|siret|siren|naf|ape|tva|rcs)/i,
  /^(merci|au revoir|bonne|ticket|facture|reçu|caisse|heure)/i,
  /^[*\-=_]{3,}/, // Separator lines
  /^\d{5}\s/, // Postal code lines
  /^(n[°o]|num)/i, // Number references
  /^www\.|^http/i, // URLs
  /^\+?\d[\d\s]{8,}$/, // Phone numbers
];

function extractMerchant(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);

  // Look in first 8 lines for the merchant name
  for (const line of lines.slice(0, 8)) {
    // Skip very short or very long lines
    if (line.length < 3 || line.length > 50) continue;

    // Skip noise patterns
    if (NOISE_PATTERNS.some(p => p.test(line))) continue;

    // Skip lines that are mostly digits/special chars
    const alphaRatio = (line.match(/[a-zA-ZÀ-ÿ]/g) || []).length / line.length;
    if (alphaRatio < 0.4) continue;

    // Clean up common OCR artifacts
    const cleaned = line
      .replace(/[|}{[\]]/g, '') // Remove OCR bracket artifacts
      .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
      .trim();

    if (cleaned.length >= 3) {
      return cleaned;
    }
  }
  return null;
}

function extractDescription(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
  for (const line of lines) {
    if (/article|produit|designation|libellé|désignation/i.test(line)) {
      return line;
    }
  }
  return null;
}

// Reusable worker for faster sequential scans
let workerInstance = null;
let workerTimeout = null;

async function getWorker() {
  if (workerInstance) {
    // Reset idle timeout
    clearTimeout(workerTimeout);
    workerTimeout = setTimeout(async () => {
      if (workerInstance) {
        await workerInstance.terminate();
        workerInstance = null;
        console.log('[ocr] Worker terminated (idle)');
      }
    }, 60_000); // Keep alive 60s
    return workerInstance;
  }

  console.log('[ocr] Creating Tesseract worker with lang:', LANG);
  workerInstance = await Tesseract.createWorker(LANG, 3);
  await workerInstance.setParameters({
    tessedit_pageseg_mode: '6', // Uniform block of text (better for varied receipt layouts)
    preserve_interword_spaces: '1',
  });

  workerTimeout = setTimeout(async () => {
    if (workerInstance) {
      await workerInstance.terminate();
      workerInstance = null;
      console.log('[ocr] Worker terminated (idle)');
    }
  }, 60_000);

  return workerInstance;
}

async function performOCR(imageBuffer) {
  const startTime = Date.now();
  const worker = await getWorker();

  try {
    const { data } = await worker.recognize(imageBuffer);
    const rawText = data.text;
    const confidence = data.confidence;
    const elapsed = Date.now() - startTime;

    console.log(`[ocr] Done in ${elapsed}ms — confidence: ${confidence}%, text length: ${rawText.length}`);
    console.log('[ocr] Raw text (first 500 chars):', rawText.substring(0, 500));

    const typeDetection = detectType(rawText);

    const extracted = {
      amount: extractAmount(rawText),
      date: extractDate(rawText),
      merchant: extractMerchant(rawText),
      type: typeDetection.type,
      description: extractDescription(rawText),
    };

    console.log('[ocr] Extracted:', JSON.stringify(extracted));
    console.log('[ocr] Type detection:', JSON.stringify(typeDetection));

    return {
      rawText,
      extracted,
      confidence,
      typeDetection: {
        type: typeDetection.type,
        scores: typeDetection.scores,
        matches: typeDetection.matches,
      },
    };
  } catch (err) {
    // If worker fails, kill it so next call gets a fresh one
    try { await workerInstance?.terminate(); } catch {}
    workerInstance = null;
    throw err;
  }
}

// Pre-warm the Tesseract worker so the first scan request is instant
async function warmupWorker() {
  try {
    console.log('[ocr] Pre-warming Tesseract worker…');
    await getWorker();
    console.log('[ocr] Worker ready');
  } catch (err) {
    console.error('[ocr] Warmup failed (non-fatal):', err.message);
  }
}

module.exports = { performOCR, warmupWorker };
