const PDFDocument = require('pdfkit');

async function generatePDF({ imageBuffer, imageMime, date, amount, type, merchant, description, userName, cardId }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
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

      const rows = [
        ['Collaborateur', userName],
        ['Carte société', cardId || 'N/A'],
        ['Date du ticket', date instanceof Date ? date.toLocaleDateString('fr-FR') : date],
        ['Montant', `${parseFloat(amount).toFixed(2)} €`],
        ['Type', type],
        ['Commerçant', merchant || 'N/A'],
        ['Description', description || 'N/A'],
        ['Soumis le', new Date().toLocaleDateString('fr-FR') + ' à ' + new Date().toLocaleTimeString('fr-FR')],
      ];

      let y = tableTop;
      for (const [label, value] of rows) {
        // Label
        doc.font('Helvetica-Bold').text(label, tableLeft, y, { width: 150 });
        // Value
        doc.font('Helvetica').text(value, col2, y, { width: 340 });
        y += 22;
      }

      // Separator
      y += 10;
      doc.moveTo(40, y).lineTo(555, y).strokeColor('#E0E0E0').lineWidth(0.5).stroke();
      y += 15;

      // Ticket image or "no receipt" banner
      if (imageBuffer && imageMime && imageMime.startsWith('image/')) {
        doc.fontSize(12).fillColor('#1A3A1C').text('Image du ticket', 40, y);
        y += 25;

        try {
          const imgOptions = {
            fit: [475, 500],
            align: 'center',
          };
          doc.image(imageBuffer, 40, y, imgOptions);
        } catch (imgErr) {
          doc.fontSize(9).fillColor('#999').text('(Image non disponible)', 40, y);
        }
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
