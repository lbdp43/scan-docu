/**
 * Route de configuration Google Drive OAuth2
 * Utilisation (une seule fois) :
 *   1. GET /api/drive/setup        → redirige vers Google pour autoriser l'accès
 *   2. Google redirige vers        → GET /api/drive/callback?code=...
 *   3. La page affiche le REFRESH TOKEN à copier dans Railway
 *
 * Cette route n'est accessible qu'avec le secret DRIVE_SETUP_SECRET en query param.
 */

const express = require('express');
const { google } = require('googleapis');

const router = express.Router();

// Scopes nécessaires pour Google Drive
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  // L'URL de callback doit matcher exactement ce qui est configuré dans Google Console
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/drive/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET requis');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Middleware : vérifie le secret de setup
function requireSetupSecret(req, res, next) {
  const secret = process.env.DRIVE_SETUP_SECRET;
  if (!secret) {
    return res.status(403).send('<h2>DRIVE_SETUP_SECRET non configuré dans les variables d\'environnement.</h2>');
  }
  if (req.query.secret !== secret) {
    return res.status(403).send('<h2>Secret invalide. Ajoutez ?secret=VOTRE_SECRET à l\'URL.</h2>');
  }
  next();
}

// GET /api/drive/setup?secret=xxx — Démarre le flow OAuth2
router.get('/setup', requireSetupSecret, (req, res) => {
  try {
    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force le retour du refresh_token
    });
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).send(`<h2>Erreur : ${err.message}</h2>`);
  }
});

// GET /api/drive/callback — Google redirige ici avec le code
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.send(`
      <html><body style="font-family:sans-serif;padding:2rem">
        <h2 style="color:red">Accès refusé</h2>
        <p>${error}</p>
      </body></html>
    `);
  }

  if (!code) {
    return res.status(400).send('<h2>Code manquant</h2>');
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return res.send(`
        <html><body style="font-family:sans-serif;padding:2rem">
          <h2 style="color:orange">⚠ Pas de refresh_token reçu</h2>
          <p>Google ne renvoie le refresh_token que la première fois. Si tu as déjà autorisé cette app :</p>
          <ol>
            <li>Va sur <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a></li>
            <li>Révoque l'accès à ton application</li>
            <li>Relance le setup</li>
          </ol>
        </body></html>
      `);
    }

    res.send(`
      <html><body style="font-family:sans-serif;padding:2rem;max-width:700px;margin:0 auto">
        <h2 style="color:green">✅ Refresh Token obtenu !</h2>
        <p>Copie cette variable dans Railway → Variables d'environnement :</p>

        <table style="width:100%;border-collapse:collapse;margin:1rem 0">
          <tr style="background:#f0f0f0">
            <th style="padding:.5rem;text-align:left;border:1px solid #ccc">Variable</th>
            <th style="padding:.5rem;text-align:left;border:1px solid #ccc">Valeur</th>
          </tr>
          <tr style="background:#fffde7">
            <td style="padding:.5rem;border:1px solid #ccc;font-weight:bold">GOOGLE_REFRESH_TOKEN</td>
            <td style="padding:.5rem;border:1px solid #ccc;font-family:monospace;word-break:break-all">${refreshToken}</td>
          </tr>
        </table>

        <p style="color:#666;font-size:.9rem">
          ⚠ Ne partage jamais ce token. Après l'avoir copié dans Railway, tu peux supprimer la variable DRIVE_SETUP_SECRET.
        </p>

        <h3>Étapes suivantes :</h3>
        <ol>
          <li>Ajoute <strong>GOOGLE_REFRESH_TOKEN</strong> dans Railway (GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET doivent déjà être configurés)</li>
          <li>Ajoute aussi <strong>DRIVE_ROOT_FOLDER_ID</strong> = l'ID de ton dossier Google Drive (visible dans l'URL du dossier)</li>
          <li>Redémarre le service Railway</li>
        </ol>
      </body></html>
    `);
  } catch (err) {
    console.error('[drive-setup] Callback error:', err);
    res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:2rem">
        <h2 style="color:red">Erreur lors de l'échange du code</h2>
        <p>${err.message}</p>
        <p>Vérifie que l'URI de redirection dans Google Console correspond exactement à celle configurée.</p>
      </body></html>
    `);
  }
});

module.exports = router;
