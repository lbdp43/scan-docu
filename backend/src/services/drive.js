const { google } = require('googleapis');
const { Readable } = require('stream');
const { PrismaClient } = require('@prisma/client');

let driveClient = null;
let cachedDbToken = null;
const settingsPrisma = new PrismaClient();

function resetDriveClient() {
  driveClient = null;
  cachedDbToken = null;
}

async function getRefreshTokenFromDb() {
  try {
    const setting = await settingsPrisma.setting.findUnique({ where: { key: 'GOOGLE_REFRESH_TOKEN' } });
    return setting?.value?.trim() || null;
  } catch {
    return null;
  }
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
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || '').trim();
  const folderId = (process.env.DRIVE_ROOT_FOLDER_ID || '').trim();

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
        status.error = `Dossier ${folderId} inaccessible: ${folderErr.message}`;
      }
    } else {
      status.error = 'DRIVE_ROOT_FOLDER_ID non configuré';
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

async function uploadToDrive(pdfBuffer, fileName, folderId) {
  const drive = await getDriveClient();

  const stream = new Readable();
  stream.push(pdfBuffer);
  stream.push(null);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/pdf',
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

module.exports = { uploadToDrive, updateDriveFile, deleteDriveFile, listDriveFiles, downloadDriveFile, resetDriveClient, isAuthError, testConnection };
