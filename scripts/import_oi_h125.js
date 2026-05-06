const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

const ROOT = path.resolve(__dirname, '..');
const DOWNLOADS = path.join(process.env.USERPROFILE, 'Downloads');
const SOURCE_PDF_NAME_PARTS = ['H125', '2026', 'unlocked'];
const OUTPUT_DIR = path.join(ROOT, 'oi_fases_h125');
const ROWS_JSON = path.join(ROOT, 'oi_h125_rows.json');
const DRIVE_FOLDER_NAME = 'OI_H125';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slug(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function findSourcePdf() {
  const files = fs.readdirSync(DOWNLOADS);
  const file = files.find(name => {
    const upper = name.toUpperCase();
    return SOURCE_PDF_NAME_PARTS.every(part => upper.includes(part.toUpperCase())) && upper.endsWith('.PDF');
  });
  if (!file) throw new Error('PDF H125 desbloqueado nao encontrado em Downloads.');
  return path.join(DOWNLOADS, file);
}

async function getPdfText(pdf, firstPage, lastPage) {
  let text = '';
  for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    text += ' ' + content.items.map(item => item.str).join(' ');
  }
  return normalizeText(text);
}

function parseIndex(text, numPages) {
  const markerRegex = /(PESOP|PEVOP)\s+-\s+SUBPROGRAMA|FASE\s+[\u2013-]\s+\d{2}[A-Z]{2}\d{2}\s+[\u2013-]/g;
  const phaseRegex = /FASE\s+[\u2013-]\s+(\d{2}[A-Z]{2}\d{2})\s+[\u2013-]\s+(.+?)\s+\((SP[A-Z]{2}-\d+)\)\s+(\d{1,3})/y;
  const programRegex = /(PESOP|PEVOP)\s+-\s+SUBPROGRAMA/y;
  const entries = [];
  let currentProgram = '';
  let marker;

  while ((marker = markerRegex.exec(text))) {
    const index = marker.index;
    programRegex.lastIndex = index;
    const programMatch = programRegex.exec(text);
    if (programMatch) {
      currentProgram = programMatch[1];
      continue;
    }

    phaseRegex.lastIndex = index;
    const phaseMatch = phaseRegex.exec(text);
    if (!phaseMatch) continue;

    entries.push({
      programa: currentProgram || 'PEVOP',
      subprograma: phaseMatch[3],
      faseId: phaseMatch[1],
      titulo: normalizeText(phaseMatch[2]),
      pagInicial: Number(phaseMatch[4])
    });
  }

  const unique = entries.filter((entry, index, all) =>
    index === all.findIndex(item =>
      item.programa === entry.programa &&
      item.subprograma === entry.subprograma &&
      item.faseId === entry.faseId &&
      item.titulo === entry.titulo &&
      item.pagInicial === entry.pagInicial
    )
  );

  unique.sort((a, b) => a.pagInicial - b.pagInicial || a.subprograma.localeCompare(b.subprograma));
  return unique.map((entry, index) => ({
    ...entry,
    pagFinal: index < unique.length - 1 ? unique[index + 1].pagInicial - 1 : numPages
  }));
}

function extractMissionCodesFromText(text, faseId) {
  const codes = new Set();
  const cleanText = normalizeText(text);
  const developmentIndex = cleanText.indexOf('DESENVOLVIMENTO DA FASE');
  const missionText = developmentIndex >= 0 ? cleanText.slice(developmentIndex) : cleanText;

  const explicitRegex = /\d{2}[A-Z]{2}\d{2}[A-Z]\d{2}/g;
  for (const match of missionText.match(explicitRegex) || []) {
    if (match.startsWith(faseId)) codes.add(match);
  }

  const tableRegex = /(\d{2}[A-Z]{2}\d{2}[A-Z])\)\s+EXERC\S*\s+MISS\S*\s+((?:\d{2}\s+){0,40}\d{2})/g;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(cleanText))) {
    const base = tableMatch[1];
    if (!base.startsWith(faseId)) continue;

    for (const number of tableMatch[2].match(/\d{2}/g) || []) {
      codes.add(`${base}${number}`);
    }
  }

  return [...codes].sort();
}

async function annotateMissionCodes(pdf, entries) {
  for (const entry of entries) {
    const phaseText = await getPdfText(pdf, entry.pagInicial, entry.pagFinal);
    entry.missoes = extractMissionCodesFromText(phaseText, entry.faseId).join(' ');
  }
}

async function splitPdf(sourcePath, entries) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const sourceBytes = fs.readFileSync(sourcePath);
  const sourceDoc = await PDFDocument.load(sourceBytes);

  for (const entry of entries) {
    const targetDoc = await PDFDocument.create();
    const pages = [];
    for (let page = entry.pagInicial; page <= entry.pagFinal; page += 1) {
      pages.push(page - 1);
    }
    const copiedPages = await targetDoc.copyPages(sourceDoc, pages);
    copiedPages.forEach(page => targetDoc.addPage(page));
    const fileName = `${slug(`H125_${entry.subprograma}_${entry.faseId}_${entry.titulo}`)}.pdf`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(filePath, await targetDoc.save());
    entry.fileName = fileName;
    entry.filePath = filePath;
  }
}

async function getAccessToken() {
  const claspPath = path.join(process.env.USERPROFILE, '.clasprc.json');
  const tokenData = JSON.parse(fs.readFileSync(claspPath, 'utf8')).tokens.default;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: tokenData.client_id,
      client_secret: tokenData.client_secret,
      refresh_token: tokenData.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  if (!response.ok) throw new Error(`Falha ao obter token Google: ${response.status}`);
  return (await response.json()).access_token;
}

function driveHeaders(token, contentType = 'application/json') {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': contentType
  };
}

async function driveJson(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...driveHeaders(token, options.contentType || 'application/json'),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Drive API ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function ensureFolder(token) {
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const search = await driveJson(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=10`);
  if (search.files && search.files[0]) return search.files[0];

  const folder = await driveJson(token, 'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
    method: 'POST',
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
  await setAnyoneReader(token, folder.id);
  return folder;
}

async function setAnyoneReader(token, fileId) {
  try {
    await driveJson(token, `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ type: 'anyone', role: 'reader' })
    });
  } catch (err) {
    if (!String(err.message || err).includes('alreadyExists')) throw err;
  }
}

async function findFileInFolder(token, folderId, fileName) {
  const safeName = fileName.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name='${safeName}' and '${folderId}' in parents and trashed=false`);
  const result = await driveJson(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=1`);
  return result.files && result.files[0] ? result.files[0] : null;
}

async function uploadPdf(token, folderId, entry) {
  const existing = await findFileInFolder(token, folderId, entry.fileName);
  if (existing) {
    await setAnyoneReader(token, existing.id);
    return existing;
  }

  const boundary = `oi_h125_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = {
    name: entry.fileName,
    parents: [folderId],
    mimeType: 'application/pdf'
  };
  const fileBytes = fs.readFileSync(entry.filePath);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Upload ${entry.fileName} falhou: ${response.status} ${text}`);
  const file = JSON.parse(text);
  await setAnyoneReader(token, file.id);
  return file;
}

function buildRows(entries) {
  const header = ['OI_KEY', 'PROGRAMA', 'SUBPROGRAMA', 'FASE_ID', 'TITULO', 'PDF_URL', 'PAG_INICIAL', 'PAG_FINAL', 'TIPO', 'STATUS', 'CHAVE_EXIBICAO', 'PDF_FASE_URL', 'MISSOES'];
  const rows = entries.map(entry => {
    const tipo = slug(entry.titulo);
    const oiKey = `${entry.programa}|${entry.subprograma}|${entry.faseId}|${tipo}`;
    return [
      oiKey,
      entry.programa,
      entry.subprograma,
      entry.faseId,
      entry.titulo,
      '',
      entry.pagInicial,
      entry.pagFinal,
      tipo,
      'ATIVO',
      `${entry.faseId} - ${entry.titulo}`,
      entry.webViewLink,
      entry.missoes || ''
    ];
  });
  return [header, ...rows];
}

async function main() {
  const sourcePath = findSourcePdf();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(sourcePath)) }).promise;
  const indexText = await getPdfText(pdf, 5, 9);
  const entries = parseIndex(indexText, pdf.numPages);
  if (!entries.length) throw new Error('Nenhuma fase encontrada no indice H125.');

  await annotateMissionCodes(pdf, entries);
  await splitPdf(sourcePath, entries);
  const token = await getAccessToken();
  const folder = await ensureFolder(token);

  for (let index = 0; index < entries.length; index += 1) {
    const file = await uploadPdf(token, folder.id, entries[index]);
    entries[index].webViewLink = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
    if ((index + 1) % 20 === 0 || index === entries.length - 1) {
      console.log(`Upload H125: ${index + 1}/${entries.length}`);
    }
  }

  const rows = buildRows(entries);
  fs.writeFileSync(ROWS_JSON, JSON.stringify(rows, null, 2), 'utf8');
  console.log(JSON.stringify({
    source: sourcePath,
    folderId: folder.id,
    folderUrl: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
    entries: entries.length,
    rowsJson: ROWS_JSON
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
