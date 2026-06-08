/**
 * Route de configuration Google Drive OAuth2
 *
 * Flow admin (depuis l'app) :
 *   1. Frontend appelle GET /api/drive/auth-url (JWT admin)
 *   2. Admin ouvre l'URL Google dans un popup/nouvel onglet
 *   3. Google redirige vers GET /api/drive/callback?code=...
 *   4. Le callback sauvegarde le refresh token en DB et redirige vers l'app
 *
 * Flow legacy (setup initial sans app) :
 *   1. GET /api/drive/setup?secret=xxx → redirige vers Google
 *   2. Callback affiche le token à copier
 */

const express = require('express');
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, checkAdmin } = require('../middleware/auth');
const { resetDriveClient } = require('../services/drive');

const router = express.Router();
const prisma = new PrismaClient();

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/drive/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET requis');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// GET /api/drive/auth-url — Returns the Google OAuth URL (admin only, JWT auth)
router.get('/auth-url', authenticateToken, checkAdmin, (req, res) => {
  try {
    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: 'app',
    });
    res.json({ url: authUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy: GET /api/drive/setup?secret=xxx
router.get('/setup', (req, res) => {
  const secret = process.env.DRIVE_SETUP_SECRET;
  if (!secret || req.query.secret !== secret) {
    return res.status(403).send('<h2>Secret invalide.</h2>');
  }
  try {
    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: 'legacy',
    });
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).send(`<h2>Erreur : ${err.message}</h2>`);
  }
});

// GET /api/drive/callback — Google redirects here
router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const isAppFlow = state === 'app';
  const frontendUrl = process.env.FRONTEND_URL || '';

  if (error) {
    if (isAppFlow && frontendUrl) {
      return res.redirect(`${frontendUrl}/admin?drive=error&msg=${encodeURIComponent(error)}`);
    }
    return res.send(`<html><body style="font-family:sans-serif;padding:2rem"><h2 style="color:red">Accès refusé</h2><p>${error}</p></body></html>`);
  }

  if (!code) {
    return res.status(400).send('<h2>Code manquant</h2>');
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      const msg = 'Pas de refresh_token reçu. Révoquez l\'accès sur myaccount.google.com/permissions puis réessayez.';
      if (isAppFlow && frontendUrl) {
        return res.redirect(`${frontendUrl}/admin?drive=no_token&msg=${encodeURIComponent(msg)}`);
      }
      return res.send(`
        <html><body style="font-family:sans-serif;padding:2rem">
          <h2 style="color:orange">Pas de refresh_token reçu</h2>
          <p>Google ne renvoie le refresh_token que la première fois. Si vous avez déjà autorisé cette app :</p>
          <ol>
            <li>Allez sur <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a></li>
            <li>Révoquez l'accès à l'application</li>
            <li>Relancez le setup</li>
          </ol>
        </body></html>
      `);
    }

    // Save refresh token to DB
    await prisma.setting.upsert({
      where: { key: 'GOOGLE_REFRESH_TOKEN' },
      update: { value: refreshToken },
      create: { key: 'GOOGLE_REFRESH_TOKEN', value: refreshToken },
    });

    // Reset cached drive client so it picks up the new token
    resetDriveClient();

    console.log('[drive-setup] New refresh token saved to DB');

    if (isAppFlow && frontendUrl) {
      return res.redirect(`${frontendUrl}/admin?drive=success`);
    }

    // Legacy flow: show token on page
    res.send(`
      <html><body style="font-family:sans-serif;padding:2rem;max-width:700px;margin:0 auto">
        <h2 style="color:green">Refresh Token obtenu et sauvegardé !</h2>
        <p>Le token a été sauvegardé automatiquement en base de données. Google Drive est reconnecté.</p>
        <p style="color:#666;font-size:.9rem">Vous pouvez fermer cette page et retourner dans l'app.</p>
      </body></html>
    `);
  } catch (err) {
    console.error('[drive-setup] Callback error:', err);
    if (isAppFlow && frontendUrl) {
      return res.redirect(`${frontendUrl}/admin?drive=error&msg=${encodeURIComponent(err.message)}`);
    }
    res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:2rem">
        <h2 style="color:red">Erreur lors de l'échange du code</h2>
        <p>${err.message}</p>
      </body></html>
    `);
  }
});

module.exports = router;
