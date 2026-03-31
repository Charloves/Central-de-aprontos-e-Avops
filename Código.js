/***************
 * CONFIG GERAL
 ***************/
const SHEET_CONFIG = 'CONFIG';
const SHEET_EFETIVO = 'EFETIVO';
const SHEET_AVOPS = 'AVOPS';
const SHEET_LEITURAS = 'LEITURAS';
const SHEET_EMAIL_LOG = 'EMAIL_LOG';
const SHEET_APRONTOS = 'APRONTOS';
const SHEET_PRESENCAS = 'PRESENCAS';
const SHEET_OI_H50 = 'OI_H50';
const SHEET_OI_H125 = 'OI_H125';

const COBRAR_APENAS_DENTRO_PRAZO = true;
const INTERVALO_COBRANCA_DIAS = 7;
const INTERVALO_ALERTA_CHEFE_DIAS = 7;

/************************
 * FUNÇÕES UTILITÁRIAS
 ************************/
function normalize_(s) {
  return String(s ?? '').trim();
}

function normalizeUpper_(s) {
  return normalize_(s).toUpperCase();
}

function getTable_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error(`Aba ${sheetName} não encontrada.`);

  const values = sh.getDataRange().getValues();
  if (!values || values.length < 1) {
    throw new Error(`Aba ${sheetName} está vazia.`);
  }

  return { sh, values, header: values[0] };
}

function findHeaderIndex_(headerRow, colName) {
  const idx = headerRow.indexOf(colName);
  if (idx === -1) {
    throw new Error(`Coluna "${colName}" não encontrada. Verifique os cabeçalhos.`);
  }
  return idx;
}

function getWebAppBaseUrl_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh) throw new Error(`Aba ${SHEET_CONFIG} não encontrada.`);

  const base = String(sh.getRange('B1').getValue()).trim();
  if (!base) {
    throw new Error(`Preencha ${SHEET_CONFIG}!B1 com a URL base do Web App (terminando em /exec).`);
  }

  return base.replace(/\/+$/, '');
}

function getChefeEmail_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh) return '';
  return String(sh.getRange('B2').getValue() || '').trim();
}

function buildWebAppUrl_(baseUrl, avopId) {
  return `${baseUrl}?avop=${encodeURIComponent(String(avopId).trim())}`;
}

function addQueryParam_(url, key, value) {
  const u = String(url || '').trim();
  if (!u) return u;
  const sep = u.includes('?') ? '&' : '?';
  return u + sep + encodeURIComponent(key) + '=' + encodeURIComponent(String(value || '').trim());
}

function toDrivePreviewUrl_(url) {
  const s = String(url || '').trim();

  if (s.includes('/preview')) return s;

  const m = s.match(/\/file\/d\/([^/]+)/);
  if (m) {
    return `https://drive.google.com/file/d/${m[1]}/preview`;
  }

  return s;
}

function toDriveDownloadUrl_(url) {
  const s = String(url || '').trim();

  let m = s.match(/\/file\/d\/([^/]+)/);
  if (m) {
    return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  }

  m = s.match(/[?&]id=([^&]+)/);
  if (m) {
    return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  }

  return s;
}

function getFirstEmptyRow_(sheet, startRow, keyCol) {
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return startRow;

  const values = sheet.getRange(startRow, keyCol, lastRow - startRow + 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === '') {
      return startRow + i;
    }
  }

  return lastRow + 1;
}

function perfilAlvoIncluiPerfil_(perfilAlvo, perfilPessoa) {
  const alvo = normalizeUpper_(perfilAlvo);
  const perfil = normalizeUpper_(perfilPessoa);

  if (!alvo) return false;
  if (alvo === 'TODOS') return true;

  const alvos = alvo.split(',').map(s => s.trim()).filter(Boolean);
  return alvos.includes(perfil);
}

function publicoIncluiPerfil_(publico, perfil) {
  const pub = normalizeUpper_(publico);
  const perf = normalizeUpper_(perfil);

  if (!pub) return false;
  if (pub === 'TODOS') return true;

  const pubs = pub.split(',').map(s => s.trim()).filter(Boolean);
  return pubs.includes(perf);
}

function calcularStatusFinal_(status, cienciaMaterial) {
  const st = normalizeUpper_(status);
  const cm = normalizeUpper_(cienciaMaterial);

  if (st === 'PRESENTE') return 'PRESENTE';
  if (st === 'JUSTIFICADO') return cm === 'SIM' ? 'JUSTIFICADO COM CIÊNCIA' : 'JUSTIFICADO SEM CIÊNCIA';
  if (st === 'AUSENTE') return 'AUSENTE';
  return 'PENDENTE';
}

function validarIdAtivo_(id) {
  const { values: ef, header: eh } = getTable_(SHEET_EFETIVO);
  const e_id = findHeaderIndex_(eh, 'ID');
  const e_ativo = findHeaderIndex_(eh, 'ATIVO');

  for (let i = 1; i < ef.length; i++) {
    if (normalizeUpper_(ef[i][e_id]) === id) {
      return {
        ok: true,
        ativo: normalizeUpper_(ef[i][e_ativo]) === 'SIM'
      };
    }
  }

  return { ok: false, ativo: false };
}

function getPerfilEfetivo_(idUpper) {
  const { values: ef, header: eh } = getTable_(SHEET_EFETIVO);
  const e_id = findHeaderIndex_(eh, 'ID');
  const e_ativo = findHeaderIndex_(eh, 'ATIVO');
  const e_perfil = findHeaderIndex_(eh, 'PERFIL');

  for (let i = 1; i < ef.length; i++) {
    if (normalizeUpper_(ef[i][e_id]) === idUpper) {
      return {
        ok: true,
        ativo: normalizeUpper_(ef[i][e_ativo]) === 'SIM',
        perfil: normalizeUpper_(ef[i][e_perfil])
      };
    }
  }

  return { ok: false, ativo: false, perfil: '' };
}

function getOiSheetName_(aeronave) {
  const aero = normalizeUpper_(aeronave);

  if (aero === 'H50') return SHEET_OI_H50;
  if (aero === 'H125') return SHEET_OI_H125;

  throw new Error('Aeronave inválida para busca de OI.');
}

function extractOiCodigo_(oiKey) {
  const parts = normalizeUpper_(oiKey).split('|').map(s => s.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[2] : '';
}

function buildOiViewerUrl_(pdfUrl, pagInicial) {
  const s = String(pdfUrl || '').trim();
  const page = Number(pagInicial || 1);

  let m = s.match(/\/file\/d\/([^/]+)/);
  if (!m) {
    m = s.match(/[?&]id=([^&]+)/);
  }

  if (m) {
    const fileId = m[1];
    return `https://drive.google.com/file/d/${fileId}/preview?rm=minimal#page=${page}`;
  }

  return `${s}#page=${page}`;
}

function matchOiCodigo_(codigoBusca, codigoBase) {
  const busca = normalizeUpper_(codigoBusca).replace(/[^A-Z0-9]/g, '');
  const base = normalizeUpper_(codigoBase).replace(/[^A-Z0-9]/g, '');

  if (!busca || !base) return { ok: false, score: 999 };

  if (base === busca) return { ok: true, score: 0 };
  if (base.startsWith(busca)) return { ok: true, score: 1 };

  if (
    busca.length >= 6 &&
    base.startsWith(busca.slice(0, 4)) &&
    base.endsWith(busca.slice(-2))
  ) {
    return { ok: true, score: 2 };
  }

  if (base.includes(busca)) return { ok: true, score: 3 };

  return { ok: false, score: 999 };
}

function getCentralOI(params) {
  const id = normalizeUpper_(params?.id);
  const codigo = normalizeUpper_(params?.codigo).replace(/[^A-Z0-9]/g, '');
  const aeronave = normalizeUpper_(params?.aeronave);

  if (!id) return { ok: false, msg: 'Informe Trigrama.', items: [] };
  if (!codigo) return { ok: false, msg: 'Informe o código da OI.', items: [] };
  if (codigo.length < 4 || codigo.length > 9) {
    return { ok: false, msg: 'O código da OI deve ter entre 4 e 9 caracteres.', items: [] };
  }
  if (!aeronave) return { ok: false, msg: 'Selecione a aeronave.', items: [] };

  const v = validarIdAtivo_(id);
  if (!v.ok) return { ok: false, msg: 'Trigrama não encontrado no efetivo.', items: [] };
  if (!v.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.', items: [] };

  let table;
  try {
    table = getTable_(getOiSheetName_(aeronave));
  } catch (err) {
    return { ok: false, msg: `Aba de OI da aeronave ${aeronave} não encontrada.`, items: [] };
  }

  const oiVals = table.values;
  const oh = table.header;

  const o_key = findHeaderIndex_(oh, 'OI_KEY');
  const o_programa = findHeaderIndex_(oh, 'PROGRAMA');
  const o_subprograma = findHeaderIndex_(oh, 'SUBPROGRAMA');
  const o_fase = findHeaderIndex_(oh, 'FASE_ID');
  const o_titulo = findHeaderIndex_(oh, 'TITULO');
  const o_pdf = findHeaderIndex_(oh, 'PDF_URL');
  const o_pagIni = findHeaderIndex_(oh, 'PAG_INICIAL');
  const o_pagFim = findHeaderIndex_(oh, 'PAG_FINAL');
  const o_tipo = findHeaderIndex_(oh, 'TIPO');
  const o_status = findHeaderIndex_(oh, 'STATUS');
  const o_chave = findHeaderIndex_(oh, 'CHAVE_EXIBICAO');

  const items = [];

  for (let i = 1; i < oiVals.length; i++) {
    const oiKey = normalize_(oiVals[i][o_key]);
    const status = normalizeUpper_(oiVals[i][o_status]);
    const pdfUrl = normalize_(oiVals[i][o_pdf]);
    const pagInicial = Number(oiVals[i][o_pagIni] || 0);

    if (!oiKey) continue;
    if (status !== 'ATIVO') continue;
    if (!pdfUrl) continue;
    if (!pagInicial) continue;

    const codigoBase = extractOiCodigo_(oiKey);
    const match = matchOiCodigo_(codigo, codigoBase);
    if (!match.ok) continue;

    items.push({
      aeronave,
      oiKey,
      programa: normalize_(oiVals[i][o_programa]),
      subprograma: normalize_(oiVals[i][o_subprograma]),
      faseId: normalize_(oiVals[i][o_fase]),
      titulo: normalize_(oiVals[i][o_titulo]),
      pagInicial,
      pagFinal: Number(oiVals[i][o_pagFim] || 0),
      tipo: normalize_(oiVals[i][o_tipo]),
      chaveExibicao: normalize_(oiVals[i][o_chave]),
      viewerUrl: buildOiViewerUrl_(pdfUrl, pagInicial),
      score: match.score
    });
  }

  items.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.oiKey.localeCompare(b.oiKey);
  });

  const cleanItems = items.map(({ score, ...rest }) => rest);

  return { ok: true, items: cleanItems };
}
function getOiByKey_(aeronave, oiKey) {
  const sheetName = getOiSheetName_(aeronave);
  const { values, header } = getTable_(sheetName);

  const o_key = findHeaderIndex_(header, 'OI_KEY');
  const o_programa = findHeaderIndex_(header, 'PROGRAMA');
  const o_subprograma = findHeaderIndex_(header, 'SUBPROGRAMA');
  const o_fase = findHeaderIndex_(header, 'FASE_ID');
  const o_titulo = findHeaderIndex_(header, 'TITULO');
  const o_pdf = findHeaderIndex_(header, 'PDF_URL');
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
    if (status !== 'ATIVO') {
      throw new Error(`OI encontrada, mas não está ATIVA: ${alvo}`);
    }

    return {
      aeronave: normalizeUpper_(aeronave),
      oiKey: rowKey,
      programa: normalize_(values[i][o_programa]),
      subprograma: normalize_(values[i][o_subprograma]),
      faseId: normalize_(values[i][o_fase]),
      titulo: normalize_(values[i][o_titulo]),
      pdfUrl: normalize_(values[i][o_pdf]),
      pagInicial: Number(values[i][o_pagIni] || 1),
      pagFinal: Number(values[i][o_pagFim] || 0),
      tipo: normalize_(values[i][o_tipo]),
      chaveExibicao: normalize_(values[i][o_chave])
    };
  }

  throw new Error(`OI não encontrada: ${alvo}`);
}

function renderOiViewerPage_(aeronave, oiKey) {
  const oi = getOiByKey_(aeronave, oiKey);

  if (!oi.pdfUrl) {
    return HtmlService.createHtmlOutput('OI sem PDF_URL preenchida.');
  }

  const t = HtmlService.createTemplateFromFile('OiViewer');
  t.aeronave = oi.aeronave;
  t.oiKey = oi.oiKey;
  t.programa = oi.programa;
  t.subprograma = oi.subprograma;
  t.faseId = oi.faseId;
  t.titulo = oi.titulo;
  t.pdfUrl = buildOiPdfJsUrl_(oi.pdfUrl);
  t.pagInicial = oi.pagInicial;
  t.pagFinal = oi.pagFinal;
  t.tipo = oi.tipo;
  t.chaveExibicao = oi.chaveExibicao;

  return t.evaluate()
    .setTitle(`OI Viewer - ${oi.oiKey}`)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function buildOiViewerPageUrl_(baseUrl, aeronave, oiKey) {
  return `${baseUrl}?oiviewer=1&aeronave=${encodeURIComponent(aeronave)}&oi=${encodeURIComponent(oiKey)}`;
}

/************************
 * WEB APP
 ************************/
function doGet(e) {
  const avopIdParam = normalize_(e?.parameter?.avop);
  const aprontoIdParam = normalize_(e?.parameter?.apronto);
  const oiViewerParam = normalize_(e?.parameter?.oiviewer);
  const oiViewerAeronave = normalizeUpper_(e?.parameter?.aeronave);
  const oiViewerKey = normalize_(e?.parameter?.oi);

  // 0) OI VIEWER
  if (oiViewerParam === '1') {
    try {
      return renderOiViewerPage_(oiViewerAeronave, oiViewerKey);
    } catch (err) {
      return HtmlService.createHtmlOutput(
        `Erro ao abrir o visualizador da OI: ${String(err.message || err)}`
      );
    }
  }

  // 1) AVOP INDIVIDUAL
  if (avopIdParam) {
    return renderAvopPage_(avopIdParam);
  }

  // 2) APRONTO INDIVIDUAL
  if (aprontoIdParam) {
    return renderAprontoPage_(aprontoIdParam);
  }

  // 3) PORTAL
  const t = HtmlService.createTemplateFromFile('Portal');
  t.baseUrl = ScriptApp.getService().getUrl();

  return t.evaluate()
    .setTitle('Central Operacional')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
/*************************
 * AVOPS
 *************************/
function registrarLeitura(payload) {
  const avopId = normalize_(payload?.avopId);
  const id = normalizeUpper_(payload?.id);
  const nomeInformado = normalize_(payload?.nome);

  if (!avopId || !id) {
    return { ok: false, msg: 'Informe AVOP e Trigrama.' };
  }

  const validacao = validarIdAtivo_(id);
  if (!validacao.ok) return { ok: false, msg: 'Trigrama não encontrado no efetivo.' };
  if (!validacao.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.' };

  const { sh: leitSh, values: leitVals, header: lh } = getTable_(SHEET_LEITURAS);
  const l_av = findHeaderIndex_(lh, 'AVOP_ID');
  const l_id = findHeaderIndex_(lh, 'ID');

  for (let i = 1; i < leitVals.length; i++) {
    if (
      normalize_(leitVals[i][l_av]) === avopId &&
      normalizeUpper_(leitVals[i][l_id]) === id
    ) {
      return { ok: true, msg: 'Leitura já registrada. Abrindo AVOP...' };
    }
  }

  leitSh.appendRow([new Date(), avopId, id, nomeInformado, '', '']);
  SpreadsheetApp.flush();

  return { ok: true, msg: 'Leitura registrada. Abrindo AVOP...' };
}

function getCentralData(params) {
  const id = normalizeUpper_(params?.id);
  const statusFiltro = normalizeUpper_(params?.status || 'PENDENTE');
  const busca = normalize_(params?.busca || '').toLowerCase();
  const dias = Number(params?.dias || 90);

  if (!id) return { ok: false, msg: 'Informe Trigrama.', items: [] };

  const v = getPerfilEfetivo_(id);
  if (!v.ok) return { ok: false, msg: 'Trigrama não encontrado no efetivo.', items: [] };
  if (!v.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.', items: [] };
  if (!v.perfil) return { ok: false, msg: 'PERFIL não definido para este Trigrama.', items: [] };

  const { values: leituras, header: lh } = getTable_(SHEET_LEITURAS);
  const l_av = findHeaderIndex_(lh, 'AVOP_ID');
  const l_id = findHeaderIndex_(lh, 'ID');

  const lidas = new Set();
  for (let i = 1; i < leituras.length; i++) {
    lidas.add(`${normalize_(leituras[i][l_av])}|${normalizeUpper_(leituras[i][l_id])}`);
  }

  const { values: avops, header: ah } = getTable_(SHEET_AVOPS);
  const a_id = findHeaderIndex_(ah, 'AVOP_ID');
  const a_titulo = findHeaderIndex_(ah, 'TITULO');
  const a_data = findHeaderIndex_(ah, 'DATA_EMISSAO');
  const a_prazo = findHeaderIndex_(ah, 'PRAZO_DIAS');
  const a_status = findHeaderIndex_(ah, 'STATUS');
  const a_perfil = findHeaderIndex_(ah, 'PERFIL_ALVO');
  const a_exige = findHeaderIndex_(ah, 'EXIGE_CIENCIA');

  const hoje = new Date();
  const limite = new Date();
  limite.setDate(limite.getDate() - dias);

  const items = [];

  for (let i = 1; i < avops.length; i++) {
    const avopId = normalize_(avops[i][a_id]);
    const titulo = normalize_(avops[i][a_titulo]);
    const dataEmissaoRaw = avops[i][a_data];
    const prazoDias = Number(avops[i][a_prazo] || 30);
    const statusAvop = normalizeUpper_(avops[i][a_status]);
    const perfilAlvo = normalizeUpper_(avops[i][a_perfil]);
    const exigeCiencia = normalizeUpper_(avops[i][a_exige]);

    if (!avopId || !dataEmissaoRaw) continue;
    if (statusAvop !== 'ATIVO') continue;
    if (exigeCiencia !== 'SIM') continue;
    if (!perfilAlvoIncluiPerfil_(perfilAlvo, v.perfil)) continue;

    const dt = new Date(dataEmissaoRaw);
    if (dt < limite) continue;

    const venc = new Date(dt);
    venc.setDate(venc.getDate() + prazoDias);

    const key = `${avopId}|${id}`;
    const ciente = lidas.has(key);
    const status = ciente ? 'CIENTE' : 'PENDENTE';
    const atrasado = !ciente && hoje > venc;

    if (statusFiltro !== 'TODOS' && status !== statusFiltro) continue;

    if (busca) {
      const hay = (avopId + ' ' + titulo).toLowerCase();
      if (!hay.includes(busca)) continue;
    }

    items.push({
      avopId,
      titulo,
      dataEmissaoBR: dt.toLocaleDateString('pt-BR'),
      vencimentoBR: venc.toLocaleDateString('pt-BR'),
      status,
      atrasado,
      dataISO: dt.toISOString()
    });
  }

  return {
    ok: true,
    items,
    total: items.length,
    pendentes: items.filter(x => x.status === 'PENDENTE').length,
    vencidos: items.filter(x => x.status === 'PENDENTE' && x.atrasado).length
  };
}
function buildOiPdfJsUrl_(pdfUrl) {
  const s = String(pdfUrl || '').trim();

  let m = s.match(/\/file\/d\/([^/]+)/);
  if (!m) {
    m = s.match(/[?&]id=([^&]+)/);
  }

  if (m) {
    const fileId = m[1];
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
  }

  return s;
}

/*************************
 * APRONTOS
 *************************/
function registrarPresenca(payload) {
  const aprontoId = normalize_(payload?.aprontoId);
  const id = normalizeUpper_(payload?.id);

  if (!aprontoId || !id) {
    return { ok: false, msg: 'Informe apronto e Trigrama.' };
  }

  const v = validarIdAtivo_(id);
  if (!v.ok) return { ok: false, msg: 'Trigrama não encontrado no efetivo.' };
  if (!v.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.' };

  const statusApronto = getStatusApronto_(aprontoId);
  if (!statusApronto) return { ok: false, msg: 'Apronto não encontrado.' };
  if (statusApronto === 'FECHADO') return { ok: false, msg: 'Apronto fechado para registro de presença.' };

  const { sh: prSh, values: pr, header: ph } = getTable_(SHEET_PRESENCAS);
  const p_ts = findHeaderIndex_(ph, 'TIMESTAMP');
  const p_ap = findHeaderIndex_(ph, 'APRONTO_ID');
  const p_id = findHeaderIndex_(ph, 'ID');
  const p_st = findHeaderIndex_(ph, 'STATUS');
  const p_obs = findHeaderIndex_(ph, 'OBS');

  let p_final = -1;
  try {
    p_final = findHeaderIndex_(ph, 'STATUS_FINAL');
  } catch (e) {
    p_final = -1;
  }

  for (let i = 1; i < pr.length; i++) {
    if (
      normalize_(pr[i][p_ap]) === aprontoId &&
      normalizeUpper_(pr[i][p_id]) === id
    ) {
      prSh.getRange(i + 1, p_ts + 1).setValue(new Date());
      prSh.getRange(i + 1, p_st + 1).setValue('PRESENTE');
      prSh.getRange(i + 1, p_obs + 1).setValue('');

      if (p_final >= 0) {
        prSh.getRange(i + 1, p_final + 1).setValue(calcularStatusFinal_('PRESENTE', ''));
      }

      SpreadsheetApp.flush();
      return { ok: true, msg: 'Presença registrada/atualizada.' };
    }
  }

  const novaLinha = Array(ph.length).fill('');
  novaLinha[p_ts] = new Date();
  novaLinha[p_ap] = aprontoId;
  novaLinha[p_id] = id;
  novaLinha[p_st] = 'PRESENTE';
  novaLinha[p_obs] = '';
  if (p_final >= 0) novaLinha[p_final] = calcularStatusFinal_('PRESENTE', '');

  const novaLinhaNum = getFirstEmptyRow_(prSh, 2, 2);
  prSh.getRange(novaLinhaNum, 1, 1, novaLinha.length).setValues([novaLinha]);
  SpreadsheetApp.flush();

  return { ok: true, msg: 'Presença registrada.' };
}

function justificarAusencia(payload) {
  const aprontoId = normalize_(payload?.aprontoId);
  const id = normalizeUpper_(payload?.id);
  const obs = normalize_(payload?.obs || 'escala');

  if (!aprontoId || !id) {
    return { ok: false, msg: 'Informe apronto e Trigrama.' };
  }

  const v = validarIdAtivo_(id);
  if (!v.ok) return { ok: false, msg: 'Trigrama não encontrado no efetivo.' };
  if (!v.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.' };

  const statusApronto = getStatusApronto_(aprontoId);
  if (!statusApronto) return { ok: false, msg: 'Apronto não encontrado.' };
  if (statusApronto === 'FECHADO') return { ok: false, msg: 'Apronto fechado para justificativa.' };

  const { sh: prSh, values: pr, header: ph } = getTable_(SHEET_PRESENCAS);
  const p_ts = findHeaderIndex_(ph, 'TIMESTAMP');
  const p_ap = findHeaderIndex_(ph, 'APRONTO_ID');
  const p_id = findHeaderIndex_(ph, 'ID');
  const p_st = findHeaderIndex_(ph, 'STATUS');
  const p_obs = findHeaderIndex_(ph, 'OBS');
  const p_ciencia = findHeaderIndex_(ph, 'CIENCIA_MATERIAL');
  const p_final = findHeaderIndex_(ph, 'STATUS_FINAL');

  for (let i = 1; i < pr.length; i++) {
    if (
      normalize_(pr[i][p_ap]) === aprontoId &&
      normalizeUpper_(pr[i][p_id]) === id
    ) {
      const cienciaAtual = normalize_(pr[i][p_ciencia] || '');

      prSh.getRange(i + 1, p_ts + 1).setValue(new Date());
      prSh.getRange(i + 1, p_st + 1).setValue('JUSTIFICADO');
      prSh.getRange(i + 1, p_obs + 1).setValue(obs);
      prSh.getRange(i + 1, p_final + 1).setValue(calcularStatusFinal_('JUSTIFICADO', cienciaAtual));
      SpreadsheetApp.flush();

      return { ok: true, msg: 'Justificativa registrada.' };
    }
  }

  const novaLinha = Array(ph.length).fill('');
  novaLinha[p_ts] = new Date();
  novaLinha[p_ap] = aprontoId;
  novaLinha[p_id] = id;
  novaLinha[p_st] = 'JUSTIFICADO';
  novaLinha[p_obs] = obs;
  novaLinha[p_final] = calcularStatusFinal_('JUSTIFICADO', '');

  const novaLinhaNum = getFirstEmptyRow_(prSh, 2, 2);
  prSh.getRange(novaLinhaNum, 1, 1, novaLinha.length).setValues([novaLinha]);
  SpreadsheetApp.flush();

  return { ok: true, msg: 'Justificativa registrada.' };
}

function registrarCienciaMaterial(payload) {
  const aprontoId = normalize_(payload?.aprontoId);
  const id = normalizeUpper_(payload?.id);

  if (!aprontoId || !id) {
    return { ok: false, msg: 'Informe apronto e Trigrama.' };
  }

  const v = validarIdAtivo_(id);
  if (!v.ok) return { ok: false, msg: 'Trigrama não encontrado no efetivo.' };
  if (!v.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.' };

  const { sh: prSh, values: pr, header: ph } = getTable_(SHEET_PRESENCAS);
  const p_ts = findHeaderIndex_(ph, 'TIMESTAMP');
  const p_ap = findHeaderIndex_(ph, 'APRONTO_ID');
  const p_id = findHeaderIndex_(ph, 'ID');
  const p_st = findHeaderIndex_(ph, 'STATUS');
  const p_obs = findHeaderIndex_(ph, 'OBS');
  const p_ciencia = findHeaderIndex_(ph, 'CIENCIA_MATERIAL');
  const p_dataCiencia = findHeaderIndex_(ph, 'DATA_CIENCIA_MATERIAL');
  const p_final = findHeaderIndex_(ph, 'STATUS_FINAL');

  for (let i = 1; i < pr.length; i++) {
    if (
      normalize_(pr[i][p_ap]) === aprontoId &&
      normalizeUpper_(pr[i][p_id]) === id
    ) {
      const statusAtual = normalize_(pr[i][p_st] || '');

      prSh.getRange(i + 1, p_ciencia + 1).setValue('SIM');
      prSh.getRange(i + 1, p_dataCiencia + 1).setValue(new Date());
      prSh.getRange(i + 1, p_final + 1).setValue(calcularStatusFinal_(statusAtual, 'SIM'));
      SpreadsheetApp.flush();

      return { ok: true, msg: 'Ciência do material registrada.' };
    }
  }

  const novaLinha = Array(ph.length).fill('');
  novaLinha[p_ts] = new Date();
  novaLinha[p_ap] = aprontoId;
  novaLinha[p_id] = id;
  novaLinha[p_st] = '';
  novaLinha[p_obs] = '';
  novaLinha[p_ciencia] = 'SIM';
  novaLinha[p_dataCiencia] = new Date();
  novaLinha[p_final] = calcularStatusFinal_('', 'SIM');

  const novaLinhaNum = getFirstEmptyRow_(prSh, 2, 2);
  prSh.getRange(novaLinhaNum, 1, 1, novaLinha.length).setValues([novaLinha]);
  SpreadsheetApp.flush();

  return { ok: true, msg: 'Ciência do material registrada.' };
}

function getCentralAprontos(params) {
  const id = normalizeUpper_(params?.id);
  const dias = Number(params?.dias || 90);
  const statusFiltro = normalizeUpper_(params?.status || 'ABERTOS');
  const busca = normalize_(params?.busca || '').toLowerCase();

  if (!id) return { ok: false, msg: 'Informe Trigrama.', items: [] };

  const v = getPerfilEfetivo_(id);
  if (!v.ok) return { ok: false, msg: 'Trigrama não encontrado no efetivo.', items: [] };
  if (!v.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.', items: [] };
  if (!v.perfil) return { ok: false, msg: 'PERFIL não definido para este Trigrama.', items: [] };

  const { values: pr, header: ph } = getTable_(SHEET_PRESENCAS);
  const p_ap = findHeaderIndex_(ph, 'APRONTO_ID');
  const p_id = findHeaderIndex_(ph, 'ID');
  const p_st = findHeaderIndex_(ph, 'STATUS');
  const p_ciencia = findHeaderIndex_(ph, 'CIENCIA_MATERIAL');

  const meuStatus = new Map();
  const minhaCiencia = new Map();

  for (let i = 1; i < pr.length; i++) {
    if (normalizeUpper_(pr[i][p_id]) === id) {
      const aprId = normalize_(pr[i][p_ap]);
      meuStatus.set(aprId, normalizeUpper_(pr[i][p_st]));
      minhaCiencia.set(aprId, normalizeUpper_(pr[i][p_ciencia]) === 'SIM' ? 'SIM' : '');
    }
  }

  const { values: ap, header: ah } = getTable_(SHEET_APRONTOS);
  const a_id = findHeaderIndex_(ah, 'APRONTO_ID');
  const a_titulo = findHeaderIndex_(ah, 'TITULO');
  const a_data = findHeaderIndex_(ah, 'DATA');
  const a_publico = findHeaderIndex_(ah, 'PUBLICO');
  const a_status = findHeaderIndex_(ah, 'STATUS');
  const a_exige = findHeaderIndex_(ah, 'EXIGE_CIENCIA_MATERIAL');
  const a_link = findHeaderIndex_(ah, 'LINK_MATERIAL');

  const limite = new Date();
  limite.setDate(limite.getDate() - dias);

  const items = [];

  for (let i = 1; i < ap.length; i++) {
    const aprontoId = normalize_(ap[i][a_id]);
    const titulo = normalize_(ap[i][a_titulo]);
    const dataRaw = ap[i][a_data];
    const publico = normalizeUpper_(ap[i][a_publico]);
    const statusApr = normalizeUpper_(ap[i][a_status]);
    const exigeCienciaMaterial = normalizeUpper_(ap[i][a_exige]);
    const linkMaterial = normalize_(ap[i][a_link]);

    if (!aprontoId || !dataRaw) continue;

    const dt = new Date(dataRaw);
    if (dt < limite) continue;

    if (statusFiltro === 'ABERTOS' && statusApr !== 'ABERTO') continue;
    if (statusFiltro === 'FECHADOS' && statusApr !== 'FECHADO') continue;
    if (!publicoIncluiPerfil_(publico, v.perfil)) continue;

    if (busca) {
      const hay = (aprontoId + ' ' + titulo).toLowerCase();
      if (!hay.includes(busca)) continue;
    }

    const statusUsuario = meuStatus.get(aprontoId) || 'PENDENTE';
    const cienciaMaterial = minhaCiencia.get(aprontoId) || '';

    items.push({
      aprontoId,
      titulo,
      dataBR: dt.toLocaleDateString('pt-BR'),
      publico,
      statusApronto: statusApr,
      statusUsuario,
      cienciaMaterial,
      exigeCienciaMaterial,
      possuiMaterial: !!linkMaterial,
      dataISO: dt.toISOString()
    });
  }

  const pendentes = items.filter(
    x => x.statusApronto === 'ABERTO' && x.statusUsuario === 'PENDENTE'
  ).length;

  return { ok: true, items, pendentes };
}

function getStatusApronto_(aprontoId) {
  const { values: ap, header: ah } = getTable_(SHEET_APRONTOS);
  const a_id = findHeaderIndex_(ah, 'APRONTO_ID');
  const a_status = findHeaderIndex_(ah, 'STATUS');

  for (let i = 1; i < ap.length; i++) {
    if (normalize_(ap[i][a_id]) === aprontoId) {
      return normalizeUpper_(ap[i][a_status]);
    }
  }

  return '';
}

/****************************************
 * GERAÇÃO DE WEBAPP_URL
 ****************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AVOPS')
    .addItem('Gerar WEBAPP_URL (lote)', 'gerarWebAppUrlsEmLote')
    .addItem('Testar cobrança (manual)', 'cobrarPendentesDiario')
    .addToUi();
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;

    const sh = e.range.getSheet();
    if (sh.getName() !== SHEET_AVOPS) return;

    const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const colAvop = header.indexOf('AVOP_ID') + 1;
    const colWeb = header.indexOf('WEBAPP_URL') + 1;
    if (colAvop < 1 || colWeb < 1) return;

    if (e.range.getColumn() !== colAvop) return;

    const base = getWebAppBaseUrl_();
    const values = e.range.getValues();

    const urls = values.map(r => {
      const avopId = normalize_(r[0]);
      return [avopId ? buildWebAppUrl_(base, avopId) : ''];
    });

    sh.getRange(e.range.getRow(), colWeb, urls.length, 1).setValues(urls);
  } catch (err) {
    console.error(err);
  }
}

function gerarWebAppUrlsEmLote() {
  const base = getWebAppBaseUrl_();
  const { sh, values: avops, header: ah } = getTable_(SHEET_AVOPS);

  const a_id = findHeaderIndex_(ah, 'AVOP_ID');
  const a_web = findHeaderIndex_(ah, 'WEBAPP_URL');

  const out = [];
  for (let i = 1; i < avops.length; i++) {
    const avopId = normalize_(avops[i][a_id]);
    out.push([avopId ? buildWebAppUrl_(base, avopId) : '']);
  }

  if (out.length) {
    sh.getRange(2, a_web + 1, out.length, 1).setValues(out);
  }
}

/******************************
 * COBRANÇA AUTOMÁTICA
 ******************************/
function cobrarPendentesDiario() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const { values: efetivo, header: eh } = getTable_(SHEET_EFETIVO);
  const { values: avops, header: ah } = getTable_(SHEET_AVOPS);
  const { values: leituras, header: lh } = getTable_(SHEET_LEITURAS);

  const logSh = ss.getSheetByName(SHEET_EMAIL_LOG);
  if (!logSh) throw new Error(`Aba ${SHEET_EMAIL_LOG} não encontrada.`);

  const logValues = logSh.getDataRange().getValues();
  const logHeader = logValues[0];

  const e_id = findHeaderIndex_(eh, 'ID');
  const e_nome = findHeaderIndex_(eh, 'NOME');
  const e_email = findHeaderIndex_(eh, 'EMAIL');
  const e_ativo = findHeaderIndex_(eh, 'ATIVO');
  const e_perfil = findHeaderIndex_(eh, 'PERFIL');

  const a_id = findHeaderIndex_(ah, 'AVOP_ID');
  const a_titulo = findHeaderIndex_(ah, 'TITULO');
  const a_data = findHeaderIndex_(ah, 'DATA_EMISSAO');
  const a_prazo = findHeaderIndex_(ah, 'PRAZO_DIAS');
  const a_web = findHeaderIndex_(ah, 'WEBAPP_URL');
  const a_status = findHeaderIndex_(ah, 'STATUS');
  const a_perfil = findHeaderIndex_(ah, 'PERFIL_ALVO');
  const a_exige = findHeaderIndex_(ah, 'EXIGE_CIENCIA');

  const l_av = findHeaderIndex_(lh, 'AVOP_ID');
  const l_id = findHeaderIndex_(lh, 'ID');

  const lidas = new Set();
  for (let i = 1; i < leituras.length; i++) {
    const key = `${normalize_(leituras[i][l_av])}|${normalizeUpper_(leituras[i][l_id])}`;
    lidas.add(key);
  }

  const hoje = new Date();

  for (let i = 1; i < avops.length; i++) {
    const avopId = normalize_(avops[i][a_id]);
    const titulo = normalize_(avops[i][a_titulo]);
    const dataEmissao = avops[i][a_data];
    const webUrl = normalize_(avops[i][a_web]);
    const prazoDias = Number(avops[i][a_prazo] || 30);
    const statusAvop = normalizeUpper_(avops[i][a_status]);
    const perfilAlvo = normalizeUpper_(avops[i][a_perfil]);
    const exigeCiencia = normalizeUpper_(avops[i][a_exige]);

    if (!avopId || !dataEmissao || !webUrl) continue;
    if (statusAvop !== 'ATIVO') continue;
    if (exigeCiencia !== 'SIM') continue;

    const vencimento = new Date(dataEmissao);
    vencimento.setDate(vencimento.getDate() + prazoDias);

    const dentroPrazo = hoje <= vencimento;
    if (COBRAR_APENAS_DENTRO_PRAZO && !dentroPrazo) continue;

    const marco = calcularMarcoCobranca_(dataEmissao, hoje, INTERVALO_COBRANCA_DIAS);
    if (marco < 1) continue;

    for (let j = 1; j < efetivo.length; j++) {
      const ativo = normalizeUpper_(efetivo[j][e_ativo]) === 'SIM';
      if (!ativo) continue;

      const id = normalizeUpper_(efetivo[j][e_id]);
      const nome = normalize_(efetivo[j][e_nome]);
      const email = normalize_(efetivo[j][e_email]);
      const perfilUsuario = normalizeUpper_(efetivo[j][e_perfil]);

      if (!id || !email) continue;
      if (!perfilAlvoIncluiPerfil_(perfilAlvo, perfilUsuario)) continue;

      const key = `${avopId}|${id}`;
      if (lidas.has(key)) continue;

      if (marcoJaCobrado_(logValues, logHeader, avopId, id, 'LEMBRETE', marco)) continue;

      const assunto = `Pendência de ciência (AVOP): ${avopId}`;
      const corpo =
`Caro Tripulante,

consta como pendente a ciência do seguinte AVOP:

${avopId} — ${titulo}

Para registrar sua ciência, acesse o link abaixo e informe seu TRIGRAMA:

${webUrl}

Este é um lembrete automático do sistema de controle de AVOPs.
`;

      try {
        GmailApp.sendEmail(email, assunto, corpo);
        logSh.appendRow([new Date(), avopId, id, email, 'LEMBRETE', 'ENVIADO', `MARCO_${marco}`]);
      } catch (err) {
        logSh.appendRow([new Date(), avopId, id, email, 'LEMBRETE', 'ERRO', `MARCO_${marco} | ${String(err)}`]);
      }
    }
  }
}

function podeCobrarHoje_(logValues, logHeader, avopId, idUpper, tipo) {
  const idxData = findHeaderIndex_(logHeader, 'DATA');
  const idxAvop = findHeaderIndex_(logHeader, 'AVOP_ID');
  const idxId = findHeaderIndex_(logHeader, 'ID');
  const idxTipo = findHeaderIndex_(logHeader, 'TIPO');
  const idxStatus = findHeaderIndex_(logHeader, 'STATUS');

  let ultimaData = null;

  for (let i = 1; i < logValues.length; i++) {
    const rowAv = normalize_(logValues[i][idxAvop]);
    const rowId = normalizeUpper_(logValues[i][idxId]);
    const rowTipo = normalizeUpper_(logValues[i][idxTipo]);
    const rowStatus = normalizeUpper_(logValues[i][idxStatus]);

    if (rowAv === avopId && rowId === idUpper && rowTipo === tipo && rowStatus === 'ENVIADO') {
      const d = logValues[i][idxData];
      const dt = d instanceof Date ? d : new Date(d);
      if (!ultimaData || dt > ultimaData) ultimaData = dt;
    }
  }

  if (!ultimaData) return true;

  const hoje = new Date();
  const diffDias = Math.floor((hoje.getTime() - ultimaData.getTime()) / (1000 * 60 * 60 * 24));
  return diffDias >= INTERVALO_COBRANCA_DIAS;
}

function podeEnviarIntervalado_(logValues, logHeader, avopId, idUpper, tipo, intervaloDias) {
  const idxData = findHeaderIndex_(logHeader, 'DATA');
  const idxAvop = findHeaderIndex_(logHeader, 'AVOP_ID');
  const idxId = findHeaderIndex_(logHeader, 'ID');
  const idxTipo = findHeaderIndex_(logHeader, 'TIPO');
  const idxStatus = findHeaderIndex_(logHeader, 'STATUS');

  let ultima = null;

  for (let i = 1; i < logValues.length; i++) {
    const rowAv = normalize_(logValues[i][idxAvop]);
    const rowId = normalizeUpper_(logValues[i][idxId]);
    const rowTipo = normalizeUpper_(logValues[i][idxTipo]);
    const rowStatus = normalizeUpper_(logValues[i][idxStatus]);

    if (rowAv === avopId && rowId === idUpper && rowTipo === tipo && rowStatus === 'ENVIADO') {
      const d = logValues[i][idxData];
      const dt = d instanceof Date ? d : new Date(d);
      if (!ultima || dt > ultima) ultima = dt;
    }
  }

  if (!ultima) return true;

  const hoje = new Date();
  const diffDias = Math.floor((hoje.getTime() - ultima.getTime()) / (1000 * 60 * 60 * 24));
  return diffDias >= Number(intervaloDias || 1);
}

function calcularMarcoCobranca_(dataEmissao, hoje, intervaloDias) {
  const emissao = new Date(dataEmissao);
  const atual = new Date(hoje);

  const diffMs = atual.getTime() - emissao.getTime();
  const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDias < intervaloDias) return 0;
  return Math.floor(diffDias / intervaloDias);
}

function marcoJaCobrado_(logValues, logHeader, avopId, idUpper, tipo, marco) {
  const idxAvop = findHeaderIndex_(logHeader, 'AVOP_ID');
  const idxId = findHeaderIndex_(logHeader, 'ID');
  const idxTipo = findHeaderIndex_(logHeader, 'TIPO');
  const idxObs = findHeaderIndex_(logHeader, 'OBS');
  const idxStatus = findHeaderIndex_(logHeader, 'STATUS');

  for (let i = 1; i < logValues.length; i++) {
    const rowAv = normalize_(logValues[i][idxAvop]);
    const rowId = normalizeUpper_(logValues[i][idxId]);
    const rowTipo = normalizeUpper_(logValues[i][idxTipo]);
    const rowObs = normalizeUpper_(logValues[i][idxObs]);
    const rowStatus = normalizeUpper_(logValues[i][idxStatus]);

    if (
      rowAv === avopId &&
      rowId === idUpper &&
      rowTipo === tipo &&
      rowStatus === 'ENVIADO' &&
      rowObs === `MARCO_${marco}`
    ) {
      return true;
    }
  }

  return false;
}

/*****************
 * TESTES / DEBUG
 *****************/
function testeHTML() {
  const nomes = ['Index', 'index', 'Index.html'];

  for (const n of nomes) {
    try {
      HtmlService.createTemplateFromFile(n);
      Logger.log('OK achou (template carregou): ' + n);
      return;
    } catch (e) {
      Logger.log('Falhou: ' + n + ' -> ' + e.message);
    }
  }

  throw new Error('Não achou nenhum dos nomes: Index, index, Index.html');
}

function testePreview() {
  Logger.log(
    toDrivePreviewUrl_('https://drive.google.com/file/d/ABC123/view?usp=sharing')
  );
}