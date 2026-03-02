const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { authenticateToken } = require('../middleware/auth');
const { performOCR } = require('../services/ocr');
const { generatePDF } = require('../services/pdf');
const { uploadToDrive, resetDriveClient } = require('../services/drive');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Multer config — memory storage only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Type de fichier non autorisé. Accepté: JPG, PNG, WebP, PDF'));
    }
    cb(null, true);
  },
});

// POST /api/scan — Upload image, OCR, return extracted data
router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    // Verify real file type via magic bytes
    let fileTypeModule;
    try {
      fileTypeModule = await import('file-type');
    } catch (e) {
      // file-type is ESM, handle gracefully
    }

    if (fileTypeModule) {
      const detected = await fileTypeModule.fileTypeFromBuffer(req.file.buffer);
      if (detected && !['jpg', 'png', 'webp', 'pdf'].includes(detected.ext)) {
        return res.status(400).json({ error: 'Type de fichier invalide' });
      }
    }

    // Preprocess image with Sharp for better OCR — 1000px is sufficient for text recognition
    let processedBuffer = req.file.buffer;
    if (req.file.mimetype.startsWith('image/')) {
      processedBuffer = await sharp(req.file.buffer)
        .rotate() // Auto-orient from EXIF (critical for mobile photos)
        .resize(1000, null, { withoutEnlargement: true, fit: 'inside' })
        .grayscale()
        .normalize() // Auto contrast stretching
        .linear(1.3, -(255 * 0.15)) // Boost contrast for faded thermal receipts
        .sharpen({ sigma: 1.5, m1: 1.5, m2: 0.7 })
        .png() // PNG lossless for better OCR
        .toBuffer();
      console.log(`[scan] Image preprocessed: ${req.file.buffer.length} -> ${processedBuffer.length} bytes`);
    }

    // Perform OCR
    const ocrResult = await performOCR(processedBuffer);

    res.json({
      success: true,
      rawText: ocrResult.rawText,
      extracted: ocrResult.extracted,
      confidence: ocrResult.confidence,
      typeDetection: ocrResult.typeDetection,
    });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'analyse du ticket' });
  }
});

// POST /api/scan/submit — Submit scanned expense with Drive upload
router.post('/submit', upload.single('image'), async (req, res) => {
  try {
    const { date_ticket, amount, type, merchant, description } = req.body;

    if (!amount || !type) {
      return res.status(400).json({ error: 'Montant et type requis' });
    }

    const user = await req.prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const parsedAmount = parseFloat(amount);
    const ticketDate = date_ticket ? new Date(date_ticket) : new Date();
    const expenseType = type || 'autre';
    const userName = user.name.split(' ')[0];

    // Generate PDF (with image or "TICKET NON DISPONIBLE" banner)
    const hasImage = !!req.file;
    const prefix = hasImage ? 'ticket' : 'sans-ticket';
    const fileName = `${prefix}_${ticketDate.toISOString().slice(0, 10)}_${expenseType}_${parsedAmount.toFixed(2)}EUR_${userName}.pdf`;

    // Compress image for PDF (much smaller than raw mobile photo)
    let pdfImageBuffer = null;
    let pdfImageMime = null;
    if (hasImage && req.file.mimetype.startsWith('image/')) {
      pdfImageBuffer = await sharp(req.file.buffer)
        .rotate()
        .resize(1400, null, { withoutEnlargement: true, fit: 'inside' })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
      pdfImageMime = 'image/jpeg';
      console.log(`[pdf] Image compressed: ${req.file.buffer.length} -> ${pdfImageBuffer.length} bytes (${Math.round(pdfImageBuffer.length / 1024)}KB)`);
    } else if (hasImage) {
      // PDF file passed directly
      pdfImageBuffer = req.file.buffer;
      pdfImageMime = req.file.mimetype;
    }

    const pdfBuffer = await generatePDF({
      imageBuffer: pdfImageBuffer,
      imageMime: pdfImageMime,
      date: ticketDate,
      amount: parsedAmount,
      type: expenseType,
      merchant: merchant || '',
      description: description || '',
      userName: user.name,
      cardId: user.card_id,
    });

    // Upload to Google Drive
    let driveFileId = null;
    let driveFileUrl = null;
    let uploadStatus = 'pending';

    // Use user-specific folder or fall back to global root folder
    const folderId = user.drive_folder_id || process.env.DRIVE_ROOT_FOLDER_ID;

    if (pdfBuffer && folderId) {
      try {
        console.log(`[drive] Uploading ${fileName} to folder ${folderId}`);
        const driveResult = await uploadToDrive(pdfBuffer, fileName, folderId);
        driveFileId = driveResult.fileId;
        driveFileUrl = driveResult.webViewLink;
        uploadStatus = 'uploaded';
        console.log(`[drive] Upload OK: ${driveFileUrl}`);
      } catch (driveErr) {
        console.error('[drive] Upload error:', driveErr.message);
        if (driveErr.response) {
          console.error('[drive] Error details:', JSON.stringify(driveErr.response.data));
          // Reset cached client on auth errors so next request uses fresh credentials
          if (driveErr.response.data?.error === 'invalid_grant') {
            resetDriveClient();
            console.warn('[drive] Token expired — client cache cleared. Update GOOGLE_REFRESH_TOKEN and restart.');
          }
        }
        uploadStatus = 'error';
      }
    } else {
      console.warn('[drive] Skipped upload — no folder ID configured (set DRIVE_ROOT_FOLDER_ID or user.drive_folder_id)');
    }

    // Save expense to database (store compressed image for PDF regeneration on updates)
    const expense = await req.prisma.expense.create({
      data: {
        user_id: user.id,
        card_id: user.card_id,
        date_ticket: ticketDate,
        amount: parsedAmount,
        type: expenseType,
        merchant: merchant || null,
        description: description || null,
        has_receipt: !!req.file,
        receipt_image: pdfImageBuffer || null,
        drive_file_id: driveFileId,
        drive_file_url: driveFileUrl,
        file_name: fileName,
        upload_status: uploadStatus,
      },
    });

    // Exclude receipt_image blob from response
    const { receipt_image: _img, ...expenseResponse } = expense;

    res.status(201).json({
      success: true,
      expense: expenseResponse,
      driveUrl: driveFileUrl,
      uploadStatus,
    });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'envoi' });
  }
});

// POST /api/scan/retry/:id — Retry Drive upload for failed expense
router.post('/retry/:id', async (req, res) => {
  try {
    const expenseId = parseInt(req.params.id, 10);
    if (isNaN(expenseId)) {
      return res.status(400).json({ error: 'ID invalide' });
    }
    const expense = await req.prisma.expense.findUnique({
      where: { id: expenseId },
    });

    if (!expense) {
      return res.status(404).json({ error: 'Dépense non trouvée' });
    }

    if (expense.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès non autorisé' });
    }

    if (expense.upload_status === 'uploaded') {
      return res.json({ message: 'Déjà uploadé', driveUrl: expense.drive_file_url });
    }

    res.json({ message: 'Réessai en cours — fonctionnalité à compléter avec les credentials Drive' });
  } catch (err) {
    console.error('Retry error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
