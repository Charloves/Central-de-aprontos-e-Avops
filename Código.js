/***************
 * CONFIG GERAL
 ***************/
const SHEET_CONFIG = 'CONFIG';
const SHEET_EFETIVO = 'EFETIVO';
const SHEET_AVOPS = 'AVOPS';
const SHEET_LEITURAS = 'LEITURAS';
const SHEET_EMAIL_LOG = 'EMAIL_LOG';
const SHEET_PENDENCIAS = 'PENDENCIAS';
const SHEET_PENDENCIAS_RESUMO = 'PENDENCIAS_RESUMO';
const SHEET_APRONTOS = 'APRONTOS';
const SHEET_PRESENCAS = 'PRESENCAS';
const SHEET_OI_H50 = 'OI_H50';
const SHEET_OI_H125 = 'OI_H125';
const SHEET_ACESSOS_LOG = 'ACESSOS_LOG';

const COBRAR_APENAS_DENTRO_PRAZO = true;
const INTERVALO_COBRANCA_DIAS = 7;
const INTERVALO_ALERTA_CHEFE_DIAS = 7;
const SESSION_DURATION_HOURS = 12;

/************************
 * FUNCOES UTILITARIAS
 ************************/
function normalize_(s) {
  return String(s ?? '').trim();
}

function normalizeUpper_(s) {
  return normalize_(s).toUpperCase();
}

function getBaseWebAppUrl_(fallbackUrl) {
  const rawFallback = String(fallbackUrl || '').trim();
  if (rawFallback) return rawFallback.replace(/\?.*$/, '');

  try {
    const current = String(ScriptApp.getService().getUrl() || '').trim();
    if (current) return current.replace(/\?.*$/, '');
  } catch (err) {}

  try {
    return getWebAppBaseUrl_();
  } catch (err) {
    return '';
  }
}

function getTable_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error(`Aba ${sheetName} nao encontrada.`);

  const values = sh.getDataRange().getValues();
  if (!values || values.length < 1) {
    throw new Error(`Aba ${sheetName} esta vazia.`);
  }

  return { sh, values, header: values[0] };
}

function findHeaderIndex_(headerRow, colName) {
  const idx = headerRow.indexOf(colName);
  if (idx === -1) {
    throw new Error(`Coluna "${colName}" nao encontrada. Verifique os cabecalhos.`);
  }
  return idx;
}

function findOptionalHeaderIndex_(headerRow, colName) {
  return headerRow.indexOf(colName);
}

function getWebAppBaseUrl_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh) throw new Error(`Aba ${SHEET_CONFIG} nao encontrada.`);

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

function extractDriveFileId_(url) {
  const s = String(url || '').trim();
  let m = s.match(/\/file\/d\/([^/]+)/);
  if (!m) {
    m = s.match(/[?&]id=([^&]+)/);
  }
  return m ? m[1] : '';
}

function toDriveDownloadUrl_(url) {
  const s = String(url || '').trim();

  const fileId = extractDriveFileId_(s);
  if (fileId) {
    return `https://drive.google.com/uc?export=download&id=${fileId}`;
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


/* app flows moved to Auth.gs, Avops.gs, Oi.gs, Aprontos.gs and WebApp.gs */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('AVOPS')
    .addItem('Gerar WEBAPP_URL (lote)', 'gerarWebAppUrlsEmLote')
    .addItem('Preparar coluna PERFIS no EFETIVO', 'prepararEfetivoPerfis')
    .addItem('Atualizar pendencias AVOP', 'atualizarPendenciasAvops')
    .addItem('Criar botao de divulgacao', 'criarBotaoDivulgacaoAvop')
    .addItem('Divulgar AVOP selecionado', 'divulgarAvopSelecionado')
    .addItem('Testar cobranca (manual)', 'cobrarPendentesDiario')
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
 * COBRANCA AUTOMATICA
 ******************************/
function cobrarPendentesDiario() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const { values: efetivo, header: eh } = getTable_(SHEET_EFETIVO);
  const { values: avops, header: ah } = getTable_(SHEET_AVOPS);
  const { values: leituras, header: lh } = getTable_(SHEET_LEITURAS);

  const logSh = ss.getSheetByName(SHEET_EMAIL_LOG);
  if (!logSh) throw new Error(`Aba ${SHEET_EMAIL_LOG} nao encontrada.`);

  const logValues = logSh.getDataRange().getValues();
  const logHeader = logValues[0];

  const e_id = findHeaderIndex_(eh, 'ID');
  const e_nome = findHeaderIndex_(eh, 'NOME');
  const e_email = findHeaderIndex_(eh, 'EMAIL');
  const e_ativo = findHeaderIndex_(eh, 'ATIVO');
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
    const key = `${normalizarAvopIdParaComparacao_(leituras[i][l_av])}|${normalizeUpper_(leituras[i][l_id])}`;
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
      const perfilUsuario = getPerfisFromEfetivoRow_(eh, efetivo[j]);

      if (!id || !email) continue;
      if (!perfilAlvoIncluiPerfil_(perfilAlvo, perfilUsuario)) continue;

      const key = `${normalizarAvopIdParaComparacao_(avopId)}|${id}`;
      if (lidas.has(key)) continue;

      if (marcoJaCobrado_(logValues, logHeader, avopId, id, 'LEMBRETE', marco)) continue;

      const emailData = buildAvopEmailData_(avopId, titulo, webUrl, id, 'LEMBRETE');

      try {
        GmailApp.sendEmail(email, emailData.assunto, emailData.corpo, getCobrancaEmailOptions_());
        logSh.appendRow([new Date(), avopId, id, email, 'LEMBRETE', 'ENVIADO', `MARCO_${marco}`]);
      } catch (err) {
        logSh.appendRow([new Date(), avopId, id, email, 'LEMBRETE', 'ERRO', `MARCO_${marco} | ${String(err)}`]);
      }
    }
  }
}

function divulgarAvopSelecionado() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getActiveSheet();
  if (!sh || sh.getName() !== SHEET_AVOPS) {
    throw new Error(`Abra a aba ${SHEET_AVOPS} e selecione uma linha de AVOP antes de executar.`);
  }

  const row = sh.getActiveRange().getRow();
  if (row < 2) throw new Error('Selecione uma linha de AVOP, nao o cabecalho.');

  return divulgarAvopPorLinha_(row);
}

function criarBotaoDivulgacaoAvop() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_AVOPS);
  if (!sh) throw new Error(`Aba ${SHEET_AVOPS} nao encontrada.`);

  ss.setActiveSheet(sh);
  sh.setFrozenRows(1);
  sh.setColumnWidth(11, 190);
  sh.setColumnWidth(12, 190);
  sh.getImages().forEach(image => {
    const anchor = image.getAnchorCell();
    if (anchor.getColumn() >= 11 && anchor.getColumn() <= 12 && anchor.getRow() <= 3) {
      image.remove();
    }
  });
  sh.getRange('K1:L3').breakApart();
  sh.getRange('K1:L3').clearContent().clearNote();
  sh.getRange('K1:L1').merge();
  sh.getRange('K1')
    .setValue('DIVULGAR AVOP SELECIONADO')
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBackground('#0b63ce')
    .setNote('Selecione uma linha de AVOP e use o menu AVOPS > Divulgar AVOP selecionado. Se houver imagem de botao criada, clique nela.');
  sh.setRowHeight(1, 42);

  try {
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAlgAAAB4CAYAAABkW1RnAAAAAXNSR0IArs4c6QAAIABJREFUeF7tnXl4FNV5x7+q7p6Z3c0mIQkBkhAIhBBEIEFxVBBBXBAcUFwUV1FQEVcUUVwUFwRBRBBRBBARBAgIQhAIkJCEzOzu6p7v93yq6urqzuzM7OyuJCEJ+f3+3tM9VdX3qvqq6q7q+v7vVwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADg5r4B6nNw9AIAAAAAAABgH8EAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgEAAAAAAAAAAAMBgvwHAf7EOHcFzUwAAAABJRU5ErkJggg==';
    const pngBase64Button = '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';
    const blob = Utilities.newBlob(Utilities.base64Decode(pngBase64Button), 'image/png', 'divulgar-avop.png');
    const image = sh.insertImage(blob, 11, 2);
    image.setAltTextTitle('Divulgar AVOP selecionado');
    image.setAltTextDescription('Selecione uma linha de AVOP e clique para enviar a divulgacao ao publico-alvo.');
    image.assignScript('divulgarAvopSelecionado');
  } catch (err) {
    sh.getRange('K2:L3').merge();
    sh.getRange('K2')
      .setValue('Use o menu AVOPS > Divulgar AVOP selecionado')
      .setFontWeight('bold')
      .setFontColor('#0b63ce')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true, '#0b63ce', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Botao/atalho criado na aba AVOPS. Selecione um AVOP antes de acionar.',
    'Botao de divulgacao',
    8
  );
}

function divulgarAvopPorLinha_(rowNumber) {
  const { values: efetivo, header: eh } = getTable_(SHEET_EFETIVO);
  const { sh, values: avops, header: ah } = getTable_(SHEET_AVOPS);
  const logSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EMAIL_LOG);
  if (!logSh) throw new Error(`Aba ${SHEET_EMAIL_LOG} nao encontrada.`);

  const row = avops[rowNumber - 1];
  if (!row) throw new Error(`Linha ${rowNumber} nao encontrada em ${SHEET_AVOPS}.`);

  const a_id = findHeaderIndex_(ah, 'AVOP_ID');
  const a_titulo = findHeaderIndex_(ah, 'TITULO');
  const a_web = findHeaderIndex_(ah, 'WEBAPP_URL');
  const a_status = findHeaderIndex_(ah, 'STATUS');
  const a_perfil = findHeaderIndex_(ah, 'PERFIL_ALVO');
  const a_exige = findHeaderIndex_(ah, 'EXIGE_CIENCIA');

  const e_id = findHeaderIndex_(eh, 'ID');
  const e_email = findHeaderIndex_(eh, 'EMAIL');
  const e_ativo = findHeaderIndex_(eh, 'ATIVO');

  const avopId = normalize_(row[a_id]);
  const titulo = normalize_(row[a_titulo]);
  const statusAvop = normalizeUpper_(row[a_status]);
  const perfilAlvo = normalizeUpper_(row[a_perfil]);
  const exigeCiencia = normalizeUpper_(row[a_exige]);
  let webUrl = normalize_(row[a_web]);

  if (!avopId) throw new Error('AVOP_ID vazio na linha selecionada.');
  if (statusAvop !== 'ATIVO') throw new Error(`${avopId} nao esta ATIVO.`);
  if (exigeCiencia !== 'SIM') throw new Error(`${avopId} nao exige ciencia.`);
  if (!perfilAlvo) throw new Error(`${avopId} esta sem PERFIL_ALVO.`);

  if (!webUrl) {
    webUrl = buildWebAppUrl_(getWebAppBaseUrl_(), avopId);
    sh.getRange(rowNumber, a_web + 1).setValue(webUrl);
  }

  const logValues = logSh.getDataRange().getValues();
  const logHeader = logValues[0];
  let enviados = 0;
  let ignorados = 0;
  let erros = 0;

  for (let i = 1; i < efetivo.length; i++) {
    const ativo = normalizeUpper_(efetivo[i][e_ativo]) === 'SIM';
    if (!ativo) continue;

    const id = normalizeUpper_(efetivo[i][e_id]);
    const email = normalize_(efetivo[i][e_email]);
    const perfilUsuario = getPerfisFromEfetivoRow_(eh, efetivo[i]);

    if (!id || !email) continue;
    if (!perfilAlvoIncluiPerfil_(perfilAlvo, perfilUsuario)) continue;

    if (emailJaEnviado_(logValues, logHeader, avopId, id, 'DIVULGACAO')) {
      ignorados++;
      continue;
    }

    const emailData = buildAvopEmailData_(avopId, titulo, webUrl, id, 'DIVULGACAO');
    try {
      GmailApp.sendEmail(email, emailData.assunto, emailData.corpo, getCobrancaEmailOptions_());
      logSh.appendRow([new Date(), avopId, id, email, 'DIVULGACAO', 'ENVIADO', 'ENVIO_INICIAL']);
      enviados++;
    } catch (err) {
      logSh.appendRow([new Date(), avopId, id, email, 'DIVULGACAO', 'ERRO', String(err)]);
      erros++;
    }
  }

  SpreadsheetApp.getActiveSpreadsheet().toast(
    `${avopId}: ${enviados} enviados, ${ignorados} ignorados, ${erros} erros.`,
    'Divulgacao de AVOP',
    8
  );

  return { ok: true, avopId, enviados, ignorados, erros };
}

function buildAvopEmailData_(avopId, titulo, webUrl, id, tipo) {
  const linkCiencia = buildAvopCobrancaUrl_(webUrl, avopId, id);
  const isDivulgacao = normalizeUpper_(tipo) === 'DIVULGACAO';
  const assunto = isDivulgacao
    ? `Divulgação de AVOP: ${avopId}`
    : `Pendência de ciência (AVOP): ${avopId}`;
  const linhaInicial = isDivulgacao
    ? 'Foi divulgado o seguinte AVOP, com necessidade de ciência:'
    : 'Consta como pendente a ciência do seguinte AVOP:';

  return {
    assunto,
    corpo:
`Caro tripulante,

${linhaInicial}

${avopId} - ${titulo}

Para registrar ciência, acesse o link abaixo:

${linkCiencia}

CDOUT - 1º/11º GAV. Este é um lembrete automático do sistema de controle de AVOPs.
`
  };
}

function buildAvopCobrancaUrl_(webUrl, avopId, id) {
  const base = String(webUrl || '').trim();
  const token = gerarTokenSessao_(id);
  const url = base || buildWebAppUrl_(getWebAppBaseUrl_(), avopId);
  return [
    addQueryParam_(url, 'token', token),
    'auto=1',
    'returnAba=AVOP',
    `returnId=${encodeURIComponent(id)}`,
    'returnAvopStatus=TODOS'
  ].join('&');
}

function getCobrancaEmailOptions_() {
  const from = getChefeEmail_() || 'cdout.1gav11@gmail.com';
  return {
    from,
    name: 'CDOUT - 1º/11º GAV'
  };
}

function testarEmailCobrancaAvop01Charles() {
  return enviarEmailCobrancaAvopTeste_('AVOP 01-2026', 'CHA', 'charlescdma@fab.mil.br');
}

function enviarEmailCobrancaAvopTeste_(avopIdAlvo, idAlvo, emailAlvo) {
  const { values: efetivo, header: eh } = getTable_(SHEET_EFETIVO);
  const { values: avops, header: ah } = getTable_(SHEET_AVOPS);
  const logSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EMAIL_LOG);
  if (!logSh) throw new Error(`Aba ${SHEET_EMAIL_LOG} nao encontrada.`);

  const e_id = findHeaderIndex_(eh, 'ID');
  const e_email = findHeaderIndex_(eh, 'EMAIL');
  const e_ativo = findHeaderIndex_(eh, 'ATIVO');
  const a_id = findHeaderIndex_(ah, 'AVOP_ID');
  const a_titulo = findHeaderIndex_(ah, 'TITULO');
  const a_web = findHeaderIndex_(ah, 'WEBAPP_URL');
  const a_status = findHeaderIndex_(ah, 'STATUS');

  const id = normalizeUpper_(idAlvo);
  let emailEfetivo = '';
  let ativo = false;
  for (let i = 1; i < efetivo.length; i++) {
    if (normalizeUpper_(efetivo[i][e_id]) !== id) continue;
    emailEfetivo = normalize_(efetivo[i][e_email]);
    ativo = normalizeUpper_(efetivo[i][e_ativo]) === 'SIM';
    break;
  }

  if (!ativo) throw new Error(`Trigrama ${id} nao esta ativo no efetivo.`);
  if (normalizeUpper_(emailEfetivo) !== normalizeUpper_(emailAlvo)) {
    throw new Error(`E-mail informado nao confere com o efetivo: ${emailEfetivo}`);
  }

  for (let i = 1; i < avops.length; i++) {
    const avopId = normalize_(avops[i][a_id]);
    if (normalizarAvopIdParaComparacao_(avopId) !== normalizarAvopIdParaComparacao_(avopIdAlvo)) continue;
    if (normalizeUpper_(avops[i][a_status]) !== 'ATIVO') throw new Error(`${avopId} nao esta ATIVO.`);

    const titulo = normalize_(avops[i][a_titulo]);
    const webUrl = normalize_(avops[i][a_web]);
    const linkCiencia = buildAvopCobrancaUrl_(webUrl, avopId, id);
    const assunto = `Pendência de ciência (AVOP): ${avopId}`;
    const corpo =
`Caro tripulante,

Consta como pendente a ciência do seguinte AVOP:

${avopId} - ${titulo}

Para registrar ciência, acesse o link abaixo:

${linkCiencia}

CDOUT - 1º/11º GAV. Este é um lembrete automático do sistema de controle de AVOPs.
`;

    try {
      GmailApp.sendEmail(emailAlvo, assunto, corpo, getCobrancaEmailOptions_());
      logSh.appendRow([new Date(), avopId, id, emailAlvo, 'TESTE_LEMBRETE', 'ENVIADO', 'TESTE_MANUAL']);
      return { ok: true, msg: `Teste enviado para ${emailAlvo}.`, link: linkCiencia };
    } catch (err) {
      logSh.appendRow([new Date(), avopId, id, emailAlvo, 'TESTE_LEMBRETE', 'ERRO', String(err)]);
      throw err;
    }
  }

  throw new Error(`AVOP nao encontrado: ${avopIdAlvo}`);
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

function emailJaEnviado_(logValues, logHeader, avopId, idUpper, tipo) {
  const idxAvop = findHeaderIndex_(logHeader, 'AVOP_ID');
  const idxId = findHeaderIndex_(logHeader, 'ID');
  const idxTipo = findHeaderIndex_(logHeader, 'TIPO');
  const idxStatus = findHeaderIndex_(logHeader, 'STATUS');
  const avopKey = normalizarAvopIdParaComparacao_(avopId);

  for (let i = 1; i < logValues.length; i++) {
    const rowAv = normalizarAvopIdParaComparacao_(logValues[i][idxAvop]);
    const rowId = normalizeUpper_(logValues[i][idxId]);
    const rowTipo = normalizeUpper_(logValues[i][idxTipo]);
    const rowStatus = normalizeUpper_(logValues[i][idxStatus]);

    if (rowAv === avopKey && rowId === idUpper && rowTipo === tipo && rowStatus === 'ENVIADO') {
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

  throw new Error('Nao achou nenhum dos nomes: Index, index, Index.html');
}

function testePreview() {
  Logger.log(
    toDrivePreviewUrl_('https://drive.google.com/file/d/ABC123/view?usp=sharing')
  );
}


