const { google } = require('googleapis');
const { Readable } = require('stream');
const { PrismaClient } = require('@prisma/client');

let driveClient = null;
let cachedDbToken = null;
let cachedRootFolderId = null;
let cachedPhotosFolderId = null;
const settingsPrisma = new PrismaClient();

function resetDriveClient() {
  driveClient = null;
  cachedDbToken = null;
  cachedRootFolderId = null;
  cachedPhotosFolderId = null;
}

async function getRefreshTokenFromDb() {
  try {
    const setting = await settingsPrisma.setting.findUnique({ where: { key: 'GOOGLE_REFRESH_TOKEN' } });
    return setting?.value?.trim() || null;
  } catch {
    return null;
  }
}

// Validate a refresh token by making a test API call, then save to DB
async function saveRefreshToken(refreshToken) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const token = (refreshToken || '').trim();

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET requis (variables Railway)');
  }
  if (!token) {
    throw new Error('Token vide');
  }

  // Test the token before saving
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: token });
  const testDrive = google.drive({ version: 'v3', auth: oauth2Client });
  const about = await testDrive.about.get({ fields: 'user' }); // throws if token invalid

  // Save to DB
  await settingsPrisma.setting.upsert({
    where: { key: 'GOOGLE_REFRESH_TOKEN' },
    update: { value: token },
    create: { key: 'GOOGLE_REFRESH_TOKEN', value: token },
  });

  resetDriveClient();
  console.log('[drive] Refresh token validated and saved to DB');

  return { email: about.data.user?.emailAddress };
}

// Resolve the root folder ID: DB setting takes priority over env var.
// With the drive.file scope, the app can only access folders it created itself,
// so the recommended path is createRootFolder() which stores the ID in DB.
async function getRootFolderId() {
  if (cachedRootFolderId) return cachedRootFolderId;
  try {
    const setting = await settingsPrisma.setting.findUnique({ where: { key: 'DRIVE_ROOT_FOLDER_ID' } });
    if (setting?.value?.trim()) {
      cachedRootFolderId = setting.value.trim();
      return cachedRootFolderId;
    }
  } catch {
    // ignore, fall back to env
  }
  const envFolder = (process.env.DRIVE_ROOT_FOLDER_ID || '').trim();
  return envFolder || null;
}

// Create a folder owned by the app (works with the drive.file scope) and save its ID to DB.
async function createRootFolder(name = 'LBDP Notes de Frais') {
  const drive = await getDriveClient();

  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id, name, webViewLink',
  });

  const folderId = response.data.id;

  await settingsPrisma.setting.upsert({
    where: { key: 'DRIVE_ROOT_FOLDER_ID' },
    update: { value: folderId },
    create: { key: 'DRIVE_ROOT_FOLDER_ID', value: folderId },
  });

  cachedRootFolderId = folderId;
  console.log(`[drive] Root folder created and saved: ${folderId}`);

  return {
    folderId,
    name: response.data.name,
    webViewLink: response.data.webViewLink,
  };
}

// Resolve the dedicated "photos" folder ID (separate from the PDF folder).
async function getPhotosFolderId() {
  if (cachedPhotosFolderId) return cachedPhotosFolderId;
  try {
    const setting = await settingsPrisma.setting.findUnique({ where: { key: 'DRIVE_PHOTOS_FOLDER_ID' } });
    if (setting?.value?.trim()) {
      cachedPhotosFolderId = setting.value.trim();
      return cachedPhotosFolderId;
    }
  } catch {
    // ignore
  }
  return null;
}

// Return the photos folder ID, creating an app-owned folder on first use.
async function ensurePhotosFolder(name = 'LBDP Photos tickets') {
  const existing = await getPhotosFolderId();
  if (existing) return existing;

  const drive = await getDriveClient();
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  const folderId = response.data.id;
  await settingsPrisma.setting.upsert({
    where: { key: 'DRIVE_PHOTOS_FOLDER_ID' },
    update: { value: folderId },
    create: { key: 'DRIVE_PHOTOS_FOLDER_ID', value: folderId },
  });

  cachedPhotosFolderId = folderId;
  console.log(`[drive] Photos folder created and saved: ${folderId}`);
  return folderId;
}

async function getDriveClient() {
  if (driveClient) return driveClient;

  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

  // DB token takes priority over env var
  if (!cachedDbToken) {
    cachedDbToken = await getRefreshTokenFromDb();
  }
  const refreshToken = cachedDbToken || (process.env.GOOGLE_REFRESH_TOKEN || '').trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Drive non configuré. Variables requises: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'
    );
  }

  const mask = (s) => s ? `${s.slice(0, 8)}...${s.slice(-4)} (len=${s.length})` : 'MISSING';
  console.log('[drive] Client ID:', mask(clientId));
  console.log('[drive] Refresh Token:', mask(refreshToken), cachedDbToken ? '(from DB)' : '(from env)');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  console.log('[drive] OAuth2 client initialized');
  return driveClient;
}

function isAuthError(err) {
  if (err.code === 401 || err.code === 403) return true;
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('invalid_grant') || msg.includes('token') || msg.includes('unauthorized') || msg.includes('revoked')) return true;
  const data = err.response?.data;
  if (data?.error === 'invalid_grant' || data?.error === 'unauthorized_client') return true;
  if (typeof data?.error === 'object' && (data.error.code === 401 || data.error.code === 403)) return true;
  return false;
}

async function testConnection() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const dbToken = await getRefreshTokenFromDb();
  const refreshToken = dbToken || (process.env.GOOGLE_REFRESH_TOKEN || '').trim();
  const folderId = await getRootFolderId();

  const status = {
    configured: false,
    connected: false,
    folderAccessible: false,
    error: null,
    details: {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasRefreshToken: !!refreshToken,
      hasFolderId: !!folderId,
      folderId: folderId || null,
    },
  };

  if (!clientId || !clientSecret || !refreshToken) {
    status.error = 'Variables d\'environnement manquantes';
    return status;
  }

  status.configured = true;

  try {
    const drive = await getDriveClient();
    // Test: get Drive storage quota (lightweight call)
    const about = await drive.about.get({ fields: 'user' });
    status.connected = true;
    status.details.driveEmail = about.data.user?.emailAddress;

    if (folderId) {
      try {
        await drive.files.get({ fileId: folderId, fields: 'id,name' });
        status.folderAccessible = true;
      } catch (folderErr) {
        status.error = `Dossier inaccessible. Avec le scope actuel, l'app ne peut utiliser qu'un dossier qu'elle a créé elle-même. Cliquez sur « Créer le dossier ».`;
        status.details.needsFolderCreation = true;
      }
    } else {
      status.error = 'Aucun dossier Drive configuré. Cliquez sur « Créer le dossier ».';
      status.details.needsFolderCreation = true;
    }
  } catch (err) {
    resetDriveClient();
    if (isAuthError(err)) {
      status.error = 'Token expiré ou révoqué — relancez le setup OAuth (/api/drive/setup)';
    } else {
      status.error = err.message;
    }
  }

  return status;
}

async function uploadBufferToDrive(buffer, fileName, folderId, mimeType) {
  const drive = await getDriveClient();

  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType,
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id, webViewLink',
  });

  return {
    fileId: response.data.id,
    webViewLink: response.data.webViewLink,
  };
}

async function uploadToDrive(pdfBuffer, fileName, folderId) {
  return uploadBufferToDrive(pdfBuffer, fileName, folderId, 'application/pdf');
}

// Upload the raw receipt photo to a dedicated, separate Drive folder so the
// main "justificatifs" folder stays PDF-only. The photos folder is app-owned
// (works with the drive.file scope) and auto-created on first use.
async function uploadPhotoToDrive(imageBuffer, fileName, mimeType = 'image/jpeg') {
  const folderId = await ensurePhotosFolder();
  return uploadBufferToDrive(imageBuffer, fileName, folderId, mimeType);
}

async function listDriveFiles(folderId) {
  const drive = await getDriveClient();

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, webViewLink, createdTime, size)',
    orderBy: 'createdTime desc',
    pageSize: 100,
  });

  return response.data.files || [];
}

async function updateDriveFile(fileId, pdfBuffer, fileName) {
  const drive = await getDriveClient();

  const stream = new Readable();
  stream.push(pdfBuffer);
  stream.push(null);

  const response = await drive.files.update({
    fileId,
    requestBody: {
      name: fileName,
    },
    media: {
      mimeType: 'application/pdf',
      body: stream,
    },
    fields: 'id, webViewLink',
  });

  return {
    fileId: response.data.id,
    webViewLink: response.data.webViewLink,
  };
}

async function deleteDriveFile(fileId) {
  const drive = await getDriveClient();
  await drive.files.delete({ fileId });
}

async function downloadDriveFile(fileId) {
  const drive = await getDriveClient();

  // Get file metadata first
  const meta = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size',
  });

  // Download file content
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return {
    buffer: Buffer.from(response.data),
    name: meta.data.name,
    mimeType: meta.data.mimeType,
    size: meta.data.size,
  };
}

module.exports = { uploadToDrive, uploadPhotoToDrive, updateDriveFile, deleteDriveFile, listDriveFiles, downloadDriveFile, resetDriveClient, isAuthError, testConnection, saveRefreshToken, getRootFolderId, createRootFolder, ensurePhotosFolder, getPhotosFolderId };
