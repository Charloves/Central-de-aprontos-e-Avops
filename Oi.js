/********
 * OI
 ********/
function getOiSheetName_(aeronave) {
  const aero = normalizeUpper_(aeronave);
  if (aero === 'H50') return SHEET_OI_H50;
  if (aero === 'H125') return SHEET_OI_H125;
  throw new Error('Aeronave invalida para busca de OI.');
}

function extractOiCodigo_(oiKey) {
  const parts = normalizeUpper_(oiKey).split('|').map(s => s.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[2] : '';
}

function normalizeOiCompact_(value) {
  return normalizeUpper_(value).replace(/[^A-Z0-9]/g, '');
}

function extractOiPhaseCodes_(value) {
  const compact = normalizeOiCompact_(value);
  if (!compact) return [];

  const matches = compact.match(/\d{2}[A-Z]{2}\d{2}/g) || [];
  return [...new Set(matches)];
}

function extractOiMissionCodes_(value) {
  const compact = normalizeOiCompact_(value);
  if (!compact) return [];

  const matches = compact.match(/\d{2}[A-Z]{2}\d{2}[A-Z]\d{2}/g) || [];
  return [...new Set(matches)];
}

function deriveOiPhaseKey_(value) {
  const compact = normalizeOiCompact_(value);
  if (!compact) return '';

  const explicitMatches = extractOiPhaseCodes_(compact);
  if (explicitMatches.length) return explicitMatches[0];

  if (compact.length >= 6) return compact.slice(0, 6);
  return compact;
}

function tokenizeOiSearch_(value) {
  const raw = normalizeUpper_(value)
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  if (!raw) return [];
  return [...new Set(raw.split(/\s+/).map(normalizeOiCompact_).filter(token => token.length >= 2))];
}

function buildOiSearchCandidate_(row, indexes, aeronave) {
  const oiKey = normalize_(row[indexes.o_key]);
  const programa = normalize_(row[indexes.o_programa]);
  const subprograma = normalize_(row[indexes.o_subprograma]);
  const faseId = normalize_(row[indexes.o_fase]);
  const titulo = normalize_(row[indexes.o_titulo]);
  const pdfUrl = normalize_(row[indexes.o_pdf]);
  const pdfFaseUrl = indexes.o_pdfFase >= 0 ? normalize_(row[indexes.o_pdfFase]) : '';
  const missoes = indexes.o_missoes >= 0 ? normalize_(row[indexes.o_missoes]) : '';
  const pagInicial = Number(row[indexes.o_pagIni] || 0);
  const effectivePdfUrl = pdfFaseUrl || pdfUrl;
  const effectiveInitialPage = pdfFaseUrl ? 1 : pagInicial;
  const missionCodes = [
    ...extractOiMissionCodes_(missoes),
    ...extractOiMissionCodes_(oiKey),
    ...extractOiMissionCodes_(faseId),
    ...extractOiMissionCodes_(normalize_(row[indexes.o_chave]))
  ].filter(Boolean);

  return {
    aeronave,
    oiKey,
    programa,
    subprograma,
    faseId,
    titulo,
    pagInicial,
    pagFinal: Number(row[indexes.o_pagFim] || 0),
    tipo: normalize_(row[indexes.o_tipo]),
    chaveExibicao: normalize_(row[indexes.o_chave]),
    pdfUrl,
    pdfFaseUrl,
    effectivePdfUrl,
    usesPhasePdf: Boolean(pdfFaseUrl),
    viewerUrl: buildOiViewerUrl_(effectivePdfUrl, effectiveInitialPage),
    mobileViewerBaseUrl: buildOiMobileViewerUrl_(effectivePdfUrl, effectiveInitialPage),
    search: {
      codigo: normalizeOiCompact_(extractOiCodigo_(oiKey)),
      oiKey: normalizeOiCompact_(oiKey),
      faseId: normalizeOiCompact_(faseId),
      chave: normalizeOiCompact_(normalize_(row[indexes.o_chave])),
      titulo: normalizeOiCompact_(titulo),
      programa: normalizeOiCompact_(programa),
      subprograma: normalizeOiCompact_(subprograma),
      phaseCodes: [
        ...extractOiPhaseCodes_(extractOiCodigo_(oiKey)),
        ...extractOiPhaseCodes_(oiKey),
        ...extractOiPhaseCodes_(faseId),
        ...extractOiPhaseCodes_(normalize_(row[indexes.o_chave])),
        ...extractOiPhaseCodes_(missoes)
      ].filter(Boolean),
      missionCodes: [...new Set(missionCodes)],
      fields: [
        normalizeOiCompact_(extractOiCodigo_(oiKey)),
        normalizeOiCompact_(oiKey),
        normalizeOiCompact_(faseId),
        normalizeOiCompact_(normalize_(row[indexes.o_chave])),
        normalizeOiCompact_(missoes),
        normalizeOiCompact_(titulo),
        normalizeOiCompact_(programa),
        normalizeOiCompact_(subprograma)
      ].filter(Boolean)
    }
  };
}

function scoreOiMatch_(query, candidate) {
  const compact = normalizeOiCompact_(query);
  const tokens = tokenizeOiSearch_(query);
  const queryMissionCodes = extractOiMissionCodes_(query);
  const queryPhaseKey = deriveOiPhaseKey_(query);
  const search = candidate.search || {};
  const fields = search.fields || [];
  const phaseCodes = search.phaseCodes || [];
  const missionCodes = search.missionCodes || [];
  if (!compact || !fields.length) return { ok: false, score: 999, label: '' };

  if (queryMissionCodes.length) {
    const missionCode = queryMissionCodes[0];
    const missionPhase = missionCode.slice(0, 6);

    if (missionCodes.includes(missionCode)) {
      return { ok: true, score: 0, label: 'Missao exata' };
    }

    // Quando a linha tem lista de missoes, codigo completo fora da lista nao deve
    // cair no match amplo por FASE_ID. Isso separa, por exemplo, 01HE01D18 de D20/D21.
    if (missionCodes.length && phaseCodes.includes(missionPhase)) {
      return { ok: false, score: 999, label: '' };
    }

    if (!missionCodes.length && phaseCodes.includes(missionPhase)) {
      return { ok: true, score: 2, label: 'Mesma fase' };
    }
  }

  if (queryPhaseKey && phaseCodes.includes(queryPhaseKey)) {
    if (compact.length === 6) return { ok: true, score: 0, label: 'Exata' };
    if (compact.length > 6) return { ok: true, score: 1, label: 'Mesma fase' };
  }

  if (compact.length >= 4 && phaseCodes.some(code => code.startsWith(compact))) {
    return { ok: true, score: 2, label: 'Parcial' };
  }

  if (search.codigo === compact) return { ok: true, score: 0, label: 'Exata' };
  if (search.faseId === compact || search.chave === compact) return { ok: true, score: 1, label: 'Exata' };
  if (search.oiKey === compact) return { ok: true, score: 2, label: 'Exata' };

  if ((search.codigo && search.codigo.startsWith(compact)) || (search.faseId && search.faseId.startsWith(compact))) {
    return { ok: true, score: 3, label: 'Alta' };
  }

  if ((search.chave && search.chave.includes(compact)) || (search.titulo && search.titulo.includes(compact))) {
    return { ok: true, score: 4, label: 'Alta' };
  }

  if (tokens.length > 1) {
    const sameFieldMatch = fields.some(field => tokens.every(token => field.includes(token)));
    if (sameFieldMatch) return { ok: true, score: 5, label: 'Alta' };

    const distributedMatch = tokens.every(token => fields.some(field => field.includes(token)));
    if (distributedMatch) return { ok: true, score: 6, label: 'Parcial' };
  }

  if (compact.length >= 3 && fields.some(field => field.includes(compact))) {
    return { ok: true, score: 7, label: 'Parcial' };
  }

  return { ok: false, score: 999, label: '' };
}

function buildOiViewerUrl_(pdfUrl, pagInicial) {
  const s = String(pdfUrl || '').trim();
  const page = Number(pagInicial || 1);
  let m = s.match(/\/file\/d\/([^/]+)/);
  if (!m) m = s.match(/[?&]id=([^&]+)/);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview?rm=minimal#page=${page}`;
  return `${s}#page=${page}`;
}

function buildOiMobileViewerUrl_(pdfUrl, page) {
  const s = String(pdfUrl || '').trim();
  const fileId = extractDriveFileId_(s);
  const pageNum = Number(page || 1) || 1;
  if (!fileId) return `${s}#page=${pageNum}`;

  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  return `https://drive.google.com/viewerng/viewer?embedded=false&url=${encodeURIComponent(directUrl)}#page=${pageNum}`;
}

function getCentralOI(params) {
  const auth = getAuthContext_(params?.token, 'OI', 'CONSULTA', `CODIGO:${normalize_(params?.codigo)}`);
  if (!auth.ok) return { ok: false, msg: auth.msg, items: [] };

  const id = auth.id;
  const codigo = normalize_(params?.codigo);
  const aeronave = normalizeUpper_(params?.aeronave);
  if (!codigo) return { ok: false, msg: 'Informe o codigo da OI.', items: [] };
  if (normalizeOiCompact_(codigo).length < 3 || normalizeOiCompact_(codigo).length > 24) {
    return { ok: false, msg: 'Informe pelo menos 3 caracteres para pesquisar a OI.', items: [] };
  }
  if (!aeronave) return { ok: false, msg: 'Selecione a aeronave.', items: [] };

  const v = validarIdAtivo_(id);
  if (!v.ok) return { ok: false, msg: 'Trigrama nao encontrado no efetivo.', items: [] };
  if (!v.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.', items: [] };

  let table;
  try {
    table = getTable_(getOiSheetName_(aeronave));
  } catch (err) {
    return { ok: false, msg: `Aba de OI da aeronave ${aeronave} nao encontrada.`, items: [] };
  }

  const oiVals = table.values;
  const oh = table.header;
  const o_key = findHeaderIndex_(oh, 'OI_KEY');
  const o_programa = findHeaderIndex_(oh, 'PROGRAMA');
  const o_subprograma = findHeaderIndex_(oh, 'SUBPROGRAMA');
  const o_fase = findHeaderIndex_(oh, 'FASE_ID');
  const o_titulo = findHeaderIndex_(oh, 'TITULO');
  const o_pdf = findHeaderIndex_(oh, 'PDF_URL');
  const o_pdfFase = findOptionalHeaderIndex_(oh, 'PDF_FASE_URL');
  const o_missoes = findOptionalHeaderIndex_(oh, 'MISSOES');
  const o_pagIni = findHeaderIndex_(oh, 'PAG_INICIAL');
  const o_pagFim = findHeaderIndex_(oh, 'PAG_FINAL');
  const o_tipo = findHeaderIndex_(oh, 'TIPO');
  const o_status = findHeaderIndex_(oh, 'STATUS');
  const o_chave = findHeaderIndex_(oh, 'CHAVE_EXIBICAO');
  const indexes = {
    o_key, o_programa, o_subprograma, o_fase, o_titulo, o_pdf, o_pdfFase, o_missoes, o_pagIni, o_pagFim, o_tipo, o_status, o_chave
  };

  const items = [];
  for (let i = 1; i < oiVals.length; i++) {
    const oiKey = normalize_(oiVals[i][o_key]);
    const status = normalizeUpper_(oiVals[i][o_status]);
    const pdfUrl = normalize_(oiVals[i][o_pdf]);
    const pdfFaseUrl = o_pdfFase >= 0 ? normalize_(oiVals[i][o_pdfFase]) : '';
    const pagInicial = Number(oiVals[i][o_pagIni] || 0);
    if (!oiKey || status !== 'ATIVO' || (!pdfUrl && !pdfFaseUrl) || !pagInicial) continue;

    const candidate = buildOiSearchCandidate_(oiVals[i], indexes, aeronave);
    const match = scoreOiMatch_(codigo, candidate);
    if (!match.ok) continue;

    items.push({
      aeronave: candidate.aeronave,
      oiKey: candidate.oiKey,
      programa: candidate.programa,
      subprograma: candidate.subprograma,
      faseId: candidate.faseId,
      titulo: candidate.titulo,
      pagInicial: candidate.pagInicial,
      pagFinal: candidate.pagFinal,
      tipo: candidate.tipo,
      chaveExibicao: candidate.chaveExibicao,
      usesPhasePdf: candidate.usesPhasePdf,
      viewerUrl: candidate.viewerUrl,
      mobileViewerBaseUrl: candidate.mobileViewerBaseUrl,
      score: match.score,
      matchLabel: match.label
    });
  }

  items.sort((a, b) => a.score !== b.score ? a.score - b.score : a.oiKey.localeCompare(b.oiKey));
  return { ok: true, items: items.map(({ score, ...rest }) => rest) };
}

function getOiByKey_(aeronave, oiKey) {
  const { values, header } = getTable_(getOiSheetName_(aeronave));
  const o_key = findHeaderIndex_(header, 'OI_KEY');
  const o_programa = findHeaderIndex_(header, 'PROGRAMA');
  const o_subprograma = findHeaderIndex_(header, 'SUBPROGRAMA');
  const o_fase = findHeaderIndex_(header, 'FASE_ID');
  const o_titulo = findHeaderIndex_(header, 'TITULO');
  const o_pdf = findHeaderIndex_(header, 'PDF_URL');
  const o_pdfFase = findOptionalHeaderIndex_(header, 'PDF_FASE_URL');
  const o_pagIni = findHeaderIndex_(header, 'PAG_INICIAL');
  const o_pagFim = findHeaderIndex_(header, 'PAG_FINAL');
  const o_tipo = findHeaderIndex_(header, 'TIPO');
  const o_status = findHeaderIndex_(header, 'STATUS');
  const o_chave = findHeaderIndex_(header, 'CHAVE_EXIBICAO');

  const alvo = normalize_(oiKey);
  for (let i = 1; i < values.length; i++) {
    const rowKey = normalize_(values[i][o_key]);
    if (rowKey !== alvo) continue;
    const status = normalizeUpper_(values[i][o_status]);
    if (status !== 'ATIVO') throw new Error(`OI encontrada, mas nao esta ATIVA: ${alvo}`);
    return {
      aeronave: normalizeUpper_(aeronave),
      oiKey: rowKey,
      programa: normalize_(values[i][o_programa]),
      subprograma: normalize_(values[i][o_subprograma]),
      faseId: normalize_(values[i][o_fase]),
      titulo: normalize_(values[i][o_titulo]),
      pdfUrl: normalize_(values[i][o_pdf]),
      pdfFaseUrl: o_pdfFase >= 0 ? normalize_(values[i][o_pdfFase]) : '',
      pagInicial: Number(values[i][o_pagIni] || 1),
      pagFinal: Number(values[i][o_pagFim] || 0),
      tipo: normalize_(values[i][o_tipo]),
      chaveExibicao: normalize_(values[i][o_chave])
    };
  }
  throw new Error(`OI nao encontrada: ${alvo}`);
}

function getOiPdfData(payload) {
  const aeronave = normalizeUpper_(payload?.aeronave);
  const oiKey = normalize_(payload?.oiKey);
  const auth = getAuthContext_(payload?.token, 'OI', 'CARREGAR_PDF', `${aeronave}|${oiKey}`);
  if (!auth.ok) return { ok: false, msg: auth.msg };

  const oi = getOiByKey_(aeronave, oiKey);
  const sourcePdfUrl = oi.pdfFaseUrl || oi.pdfUrl;
  const fileId = extractDriveFileId_(sourcePdfUrl);
  if (!fileId) return { ok: false, msg: 'Nao foi possivel identificar o arquivo PDF desta OI.' };

  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    return {
      ok: true,
      fileName: file.getName(),
      mimeType: blob.getContentType() || 'application/pdf',
      base64: Utilities.base64Encode(blob.getBytes())
    };
  } catch (err) {
    return { ok: false, msg: `Falha ao carregar o PDF da OI: ${String(err.message || err)}` };
  }
}

function resolveOiViewerPage_(oi, requestedPage) {
  const firstPage = Number(oi?.pagInicial || 1) || 1;
  const lastPage = Number(oi?.pagFinal || 0) || 0;
  const requested = Number(requestedPage || 0);
  if (!requested || requested < 1) return firstPage;
  if (lastPage && requested > lastPage) return firstPage;
  return requested;
}

function renderOiViewerPage_(aeronave, oiKey, token, fallbackBaseUrl, requestedPage) {
  const auth = getAuthContext_(token, 'OI', 'ABRIR_PAGINA', `${aeronave}|${oiKey}`);
  if (!auth.ok) return HtmlService.createHtmlOutput(auth.msg);

  const oi = getOiByKey_(aeronave, oiKey);
  const initialPage = resolveOiViewerPage_(oi, requestedPage);
  if (!oi.pdfUrl && !oi.pdfFaseUrl) return HtmlService.createHtmlOutput('OI sem PDF_URL preenchida.');

  const t = HtmlService.createTemplateFromFile('OiViewer');
  t.aeronave = oi.aeronave;
  t.oiKey = oi.oiKey;
  t.programa = oi.programa;
  t.subprograma = oi.subprograma;
  t.faseId = oi.faseId;
  t.titulo = oi.titulo;
  t.pdfUrl = oi.pdfFaseUrl || oi.pdfUrl;
  t.pagInicial = oi.pagInicial;
  t.pagFinal = oi.pagFinal;
  t.initialPage = initialPage;
  t.tipo = oi.tipo;
  t.chaveExibicao = oi.chaveExibicao;
  t.baseUrl = getBaseWebAppUrl_(fallbackBaseUrl);
  t.token = token;
  t.authId = auth.id;

  return t.evaluate().setTitle(`OI Viewer - ${oi.oiKey}`).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function buildOiViewerPageUrl_(baseUrl, aeronave, oiKey, page) {
  let url = `${baseUrl}?oiviewer=1&aeronave=${encodeURIComponent(aeronave)}&oi=${encodeURIComponent(oiKey)}`;
  const pageNum = Number(page || 0);
  if (pageNum > 0) url += `&page=${encodeURIComponent(pageNum)}`;
  return url;
}

function fillOiPhasePdfUrlsH50() {
  return fillOiPhasePdfUrlsForSheet_(SHEET_OI_H50, '1GxM0mlnsX_PX3z7VX6tWCgWRZhS1Zrl8', 'H50');
}

function importarOiRowsJson_(sheetName, jsonFileId) {
  const targetSheetName = normalize_(sheetName);
  const fileId = normalize_(jsonFileId);
  if (!targetSheetName) throw new Error('Nome da aba nao informado.');
  if (!fileId) throw new Error('ID do arquivo JSON nao informado.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(targetSheetName);
  if (!sh) throw new Error(`Aba ${targetSheetName} nao encontrada.`);

  const content = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  const rows = JSON.parse(content);
  if (!Array.isArray(rows) || rows.length < 2 || !Array.isArray(rows[0])) {
    throw new Error('JSON de OI invalido: esperado array de linhas.');
  }

  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.setFrozenRows(1);
  SpreadsheetApp.flush();

  return {
    sheetName: targetSheetName,
    rows: rows.length,
    items: rows.length - 1,
    columns: rows[0].length
  };
}

function importarOiH125JsonRefinado() {
  return importarOiRowsJson_(SHEET_OI_H125, '1AkTJ3kNzkLOlcJn1hqMi2UN91HxRO590');
}

function fillOiPhasePdfUrlsForSheet_(sheetName, folderId, prefix) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error(`Aba ${sheetName} nao encontrada.`);

  const data = sh.getDataRange().getValues();
  if (!data || data.length < 2) {
    throw new Error(`Aba ${sheetName} sem dados para atualizar.`);
  }

  const header = data[0];
  const colSubprograma = findHeaderIndex_(header, 'SUBPROGRAMA');
  const colFase = findHeaderIndex_(header, 'FASE_ID');
  const colTitulo = findHeaderIndex_(header, 'TITULO');
  let colPdfFase = findOptionalHeaderIndex_(header, 'PDF_FASE_URL');

  if (colPdfFase === -1) {
    colPdfFase = header.length;
    sh.getRange(1, colPdfFase + 1).setValue('PDF_FASE_URL');
  }

  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const urlByName = {};
  while (files.hasNext()) {
    const file = files.next();
    const name = String(file.getName() || '').trim();
    if (!name || !/\.pdf$/i.test(name)) continue;
    urlByName[name] = file.getUrl();
  }

  const updates = [];
  let matched = 0;
  let missing = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const subprograma = normalize_(row[colSubprograma]);
    const faseId = normalize_(row[colFase]);
    const titulo = normalize_(row[colTitulo]);

    if (!subprograma || !faseId || !titulo) {
      updates.push(['']);
      continue;
    }

    const fileName = buildOiPhasePdfFileName_(prefix, subprograma, faseId, titulo);
    const url = urlByName[fileName] || '';
    if (url) matched++;
    else missing++;
    updates.push([url]);
  }

  sh.getRange(2, colPdfFase + 1, updates.length, 1).setValues(updates);
  SpreadsheetApp.flush();

  return {
    sheetName,
    folderId,
    totalRows: updates.length,
    matched,
    missing
  };
}

function buildOiPhasePdfFileName_(prefix, subprograma, faseId, titulo) {
  const safePrefix = normalizeUpper_(prefix || 'H50');
  const safeSubprograma = normalizeUpper_(subprograma);
  const safeFaseId = normalizeUpper_(faseId);
  const safeTitulo = slugOiPhasePdfPart_(titulo);
  return `${safePrefix}_${safeSubprograma}_${safeFaseId}_${safeTitulo}.pdf`;
}

function slugOiPhasePdfPart_(value) {
  return normalize_(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\/]/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toUpperCase();
}
