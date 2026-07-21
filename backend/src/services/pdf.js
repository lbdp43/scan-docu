const PDFDocument = require('pdfkit');
const { PAYMENT_LABELS, normalizeMethod, isReimbursable } = require('./payment');

async function generatePDF({ imageBuffer, imageMime, date, amount, type, merchant, description, userName, cardId, paymentMethod, reimbursementStatus, reimbursedAt, isUpdate = false }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        compress: true,
        info: {
          Title: `Ticket ${type} - ${userName}`,
          Author: 'LBDP Notes de Frais',
        },
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header with LBDP branding
      doc.fontSize(8).fillColor('#7A9C7A').text('LA BRASSERIE DES PLANTES', 40, 40);
      doc.fontSize(6).text('Notes de Frais — Justificatif', 40, 52);

      // Green accent line
      doc.moveTo(40, 65).lineTo(555, 65).strokeColor('#2D6A27').lineWidth(2).stroke();

      // Title
      doc.fontSize(16).fillColor('#1A3A1C').text('Justificatif de dépense', 40, 80);

      // Info table
      const tableTop = 115;
      const tableLeft = 40;
      const col2 = 200;

      doc.fontSize(10).fillColor('#333333');

      const method = normalizeMethod(paymentMethod);
      const methodLabel = PAYMENT_LABELS[method] || 'Carte pro';
      const reimbursable = isReimbursable(method);
      const reimbDate = reimbursedAt ? (reimbursedAt instanceof Date ? reimbursedAt : new Date(reimbursedAt)) : null;
      const isReimbursed = reimbursable && reimbursementStatus === 'reimbursed';
      const isRejected = reimbursable && reimbursementStatus === 'rejected';

      let methodSuffix = '';
      if (reimbursable) {
        if (isReimbursed) methodSuffix = reimbDate ? ` (remboursé le ${reimbDate.toLocaleDateString('fr-FR')})` : ' (remboursé)';
        else if (isRejected) methodSuffix = ' (remboursement refusé)';
        else methodSuffix = ' (à rembourser)';
      }

      const rows = [
        ['Collaborateur', userName],
        ['Carte société', method === 'carte' ? (cardId || 'N/A') : '—'],
        ['Mode de règlement', `${methodLabel}${methodSuffix}`],
        ['Date du ticket', date instanceof Date ? date.toLocaleDateString('fr-FR') : date],
        ['Montant', `${parseFloat(amount).toFixed(2)} €`],
        ['Type', type],
        ['Commerçant', merchant || 'N/A'],
        ['Description', description || 'N/A'],
        [isUpdate ? 'Modifié le' : 'Soumis le', new Date().toLocaleDateString('fr-FR') + ' à ' + new Date().toLocaleTimeString('fr-FR')],
      ];

      let y = tableTop;
      for (const [label, value] of rows) {
        // Label
        doc.font('Helvetica-Bold').fillColor('#333333').text(label, tableLeft, y, { width: 150 });
        // Value — highlight payment method row
        const highlight = label === 'Mode de règlement';
        let hlColor = '#1A3A1C';
        if (highlight && reimbursable) hlColor = isReimbursed ? '#15803D' : isRejected ? '#6B7280' : '#B45309';
        doc.font(highlight ? 'Helvetica-Bold' : 'Helvetica')
          .fillColor(highlight ? hlColor : '#333333')
          .text(value, col2, y, { width: 340 });
        y += 22;
      }
      doc.fillColor('#333333');

      // Separator
      y += 10;
      doc.moveTo(40, y).lineTo(555, y).strokeColor('#E0E0E0').lineWidth(0.5).stroke();
      y += 15;

      // Reimbursement banner — reflects the current request status
      if (reimbursable) {
        const bh = 40;
        let bg = '#FFF7ED', border = '#F59E0B', titleColor = '#B45309', subColor = '#92400E';
        let title = `DEMANDE DE REMBOURSEMENT — ${methodLabel}`;
        let sub = 'Payé par le collaborateur — à rembourser';
        if (isReimbursed) {
          bg = '#F0FDF4'; border = '#22C55E'; titleColor = '#15803D'; subColor = '#166534';
          title = 'REMBOURSÉ';
          sub = reimbDate ? `Remboursement effectué le ${reimbDate.toLocaleDateString('fr-FR')}` : 'Remboursement effectué';
        } else if (isRejected) {
          bg = '#F3F4F6'; border = '#9CA3AF'; titleColor = '#4B5563'; subColor = '#6B7280';
          title = 'REMBOURSEMENT REFUSÉ';
          sub = 'Demande de remboursement refusée';
        }
        doc.save();
        doc.roundedRect(40, y, 515, bh, 8).fillColor(bg).fill()
          .strokeColor(border).lineWidth(1.5).stroke();
        doc.fontSize(11).fillColor(titleColor).font('Helvetica-Bold')
          .text(title, 40, y + 9, { width: 515, align: 'center' });
        doc.fontSize(8).fillColor(subColor).font('Helvetica')
          .text(sub, 40, y + 24, { width: 515, align: 'center' });
        doc.restore();
        y += bh + 15;
      }

      // Ticket image or "no receipt" banner
      if (imageBuffer && imageMime && imageMime.startsWith('image/')) {
        doc.fontSize(12).fillColor('#1A3A1C').text('Image du ticket', 40, y);
        y += 25;

        try {
          // Ensure we have a proper Node.js Buffer (Prisma Bytes may return Uint8Array)
          const imgBuf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
          const imgOptions = {
            fit: [475, 500],
            align: 'center',
          };
          doc.image(imgBuf, 40, y, imgOptions);
        } catch (imgErr) {
          console.error('[pdf] Image embed error:', imgErr.message);
          doc.fontSize(9).fillColor('#999').text('(Image non disponible)', 40, y);
        }
      } else if (isUpdate) {
        // Updated document banner (blue/green)
        y += 20;
        const bannerHeight = 120;
        doc.save();
        doc.roundedRect(40, y, 515, bannerHeight, 12)
          .fillColor('#F0FFF4').fill()
          .strokeColor('#2D6A27').lineWidth(2).stroke();

        doc.fontSize(20).fillColor('#2D6A27').font('Helvetica-Bold')
          .text('DOCUMENT MIS A JOUR', 40, y + 30, { width: 515, align: 'center' });
        doc.fontSize(10).fillColor('#4A7A46').font('Helvetica')
          .text('Les informations de cette dépense ont été modifiées', 40, y + 65, { width: 515, align: 'center' });
        doc.fontSize(9).fillColor('#6B9A67').font('Helvetica')
          .text('Le ticket original a été scanné lors de la soumission initiale', 40, y + 85, { width: 515, align: 'center' });
        doc.restore();
      } else {
        // No receipt — big visible banner
        y += 20;
        const bannerHeight = 200;
        doc.save();
        doc.roundedRect(40, y, 515, bannerHeight, 12)
          .fillColor('#FEF2F2').fill()
          .strokeColor('#DC2626').lineWidth(3).stroke();

        // Red X icon
        const cx = 297, cy = y + 60;
        doc.save();
        doc.circle(cx, cy, 30).fillColor('#FEE2E2').fill()
          .strokeColor('#DC2626').lineWidth(2).stroke();
        doc.moveTo(cx - 12, cy - 12).lineTo(cx + 12, cy + 12).strokeColor('#DC2626').lineWidth(4).stroke();
        doc.moveTo(cx + 12, cy - 12).lineTo(cx - 12, cy + 12).strokeColor('#DC2626').lineWidth(4).stroke();
        doc.restore();

        doc.fontSize(28).fillColor('#DC2626').font('Helvetica-Bold')
          .text('TICKET NON DISPONIBLE', 40, y + 110, { width: 515, align: 'center' });
        doc.fontSize(10).fillColor('#991B1B').font('Helvetica')
          .text('Saisie manuelle sans justificatif', 40, y + 150, { width: 515, align: 'center' });
        doc.restore();
      }

      // Footer
      doc.fontSize(7).fillColor('#999')
        .text('Document généré automatiquement — LBDP Notes de Frais', 40, 770, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generatePDF };
