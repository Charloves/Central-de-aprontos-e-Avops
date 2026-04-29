const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

const SOURCE_PDF = 'C:/Users/Charles Angelo/Downloads/H50 OI 2026.pdf';
const OUTPUT_DIR = 'C:/Users/Charles Angelo/OneDrive/Documentos/Google AppScript/meu-apps-script/oi_fases_h50';
const INDEX_JSON = path.join(OUTPUT_DIR, 'oi_fases_index.json');
const INDEX_CSV = path.join(OUTPUT_DIR, 'oi_fases_index.csv');

function sanitizeFileName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseIndexLine(line) {
  const clean = String(line || '').replace(/\s+/g, ' ').trim();
  const match = clean.match(/^FASE\s+.\s+(\d{2}[A-Z]{2}\d{2})\s+.\s+(.*?)\s+\((SP[A-Z]{2}-\d+)\)\s+\.{3,}\s*(\d{1,3})$/);
  if (!match) return null;

  return {
    code: match[1],
    title: match[2].trim(),
    subprogram: match[3],
    start: Number(match[4])
  };
}

async function extractPhaseIndex(pdf) {
  const entries = [];

  for (let pageNumber = 5; pageNumber <= 8; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    const linesByY = new Map();

    for (const item of text.items) {
      const y = Math.round(item.transform[5]);
      if (!linesByY.has(y)) linesByY.set(y, []);
      linesByY.get(y).push(item);
    }

    const lines = [...linesByY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) =>
        items
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map(item => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      );

    for (const line of lines) {
      const entry = parseIndexLine(line);
      if (entry) entries.push(entry);
    }
  }

  const unique = entries.filter((entry, index, all) =>
    index === all.findIndex(item =>
      item.code === entry.code &&
      item.title === entry.title &&
      item.subprogram === entry.subprogram &&
      item.start === entry.start
    )
  );

  unique.sort((a, b) => a.start - b.start || a.subprogram.localeCompare(b.subprogram) || a.code.localeCompare(b.code));

  return unique.map((entry, index) => ({
    ...entry,
    end: index < unique.length - 1 ? unique[index + 1].start - 1 : pdf.numPages
  }));
}

async function splitPdf(entries) {
  const sourceBytes = fs.readFileSync(SOURCE_PDF);
  const sourceDoc = await PDFDocument.load(sourceBytes);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const records = [];
  for (const entry of entries) {
    const targetDoc = await PDFDocument.create();
    const pageIndexes = [];
    for (let page = entry.start; page <= entry.end; page += 1) {
      pageIndexes.push(page - 1);
    }

    const copiedPages = await targetDoc.copyPages(sourceDoc, pageIndexes);
    copiedPages.forEach(page => targetDoc.addPage(page));

    const fileName = sanitizeFileName(`H50_${entry.subprogram}_${entry.code}_${entry.title}.pdf`);
    const filePath = path.join(OUTPUT_DIR, fileName);
    const bytes = await targetDoc.save();
    fs.writeFileSync(filePath, bytes);

    records.push({
      subprogram: entry.subprogram,
      fase_id: entry.code,
      titulo: entry.title,
      pag_inicial: entry.start,
      pag_final: entry.end,
      arquivo_local: filePath
    });
  }

  return records;
}

function writeIndexes(records) {
  fs.writeFileSync(INDEX_JSON, JSON.stringify(records, null, 2), 'utf8');

  const csvLines = [
    'SUBPROGRAMA,FASE_ID,TITULO,PAG_INICIAL,PAG_FINAL,ARQUIVO_LOCAL'
  ];
  for (const record of records) {
    csvLines.push([
      record.subprogram,
      record.fase_id,
      `"${String(record.titulo).replace(/"/g, '""')}"`,
      record.pag_inicial,
      record.pag_final,
      `"${String(record.arquivo_local).replace(/"/g, '""')}"`
    ].join(','));
  }

  fs.writeFileSync(INDEX_CSV, csvLines.join('\n'), 'utf8');
}

async function main() {
  const data = new Uint8Array(fs.readFileSync(SOURCE_PDF));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const entries = await extractPhaseIndex(pdf);
  const records = await splitPdf(entries);
  writeIndexes(records);
  console.log(`Arquivos gerados: ${records.length}`);
  console.log(`Indice CSV: ${INDEX_CSV}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
