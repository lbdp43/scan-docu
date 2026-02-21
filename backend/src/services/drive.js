const { google } = require('googleapis');
const { Readable } = require('stream');

let driveClient = null;

function getDriveClient() {
  if (driveClient) return driveClient;

  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || '').trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Drive non configuré. Variables requises: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'
    );
  }

  // Log masked credentials for debugging
  const mask = (s) => s ? `${s.slice(0, 8)}...${s.slice(-4)} (len=${s.length})` : 'MISSING';
  console.log('[drive] Client ID:', mask(clientId));
  console.log('[drive] Client Secret:', mask(clientSecret));
  console.log('[drive] Refresh Token:', mask(refreshToken));

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  console.log('[drive] OAuth2 client initialized');
  return driveClient;
}

async function uploadToDrive(pdfBuffer, fileName, folderId) {
  const drive = getDriveClient();

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
  const drive = getDriveClient();

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, webViewLink, createdTime, size)',
    orderBy: 'createdTime desc',
    pageSize: 100,
  });

  return response.data.files || [];
}

async function updateDriveFile(fileId, pdfBuffer, fileName) {
  const drive = getDriveClient();

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
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}

module.exports = { uploadToDrive, updateDriveFile, deleteDriveFile, listDriveFiles };
