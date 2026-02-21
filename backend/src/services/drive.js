const { google } = require('googleapis');
const { Readable } = require('stream');

let driveClient = null;

function getDriveClient() {
  if (driveClient) return driveClient;

  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY non configurée');
  }

  let credentials;
  try {
    credentials = JSON.parse(keyJson);
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY JSON invalide');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  driveClient = google.drive({ version: 'v3', auth });
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
    supportsAllDrives: true, // Support Shared Drives (service accounts need this)
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
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files || [];
}

module.exports = { uploadToDrive, listDriveFiles };
