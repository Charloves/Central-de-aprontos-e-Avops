/***********************
 * PENDENCIAS / RESUMO
 ***********************/
const PENDENCIAS_HEADERS_ = [
  'AVOP_ID',
  'TITULO',
  'DATA_EMISSAO',
  'ID',
  'NOME',
  'EMAIL',
  'ATIVO',
  'PERFIL',
  'STATUS_AVOP',
  'PERFIL_ALVO',
  'EXIGE_CIENCIA',
  'STATUS',
  'DIAS_DESDE',
  'PRAZO',
  'VENCIDO',
  'LINK_WEBAPP',
  'PROXIMA_COBRANCA'
];

const PENDENCIAS_RESUMO_HEADERS_ = [
  'AVOP_ID',
  'TITULO',
  'TOTAL_APLICAVEIS',
  'TOTAL_CIENTES',
  'TOTAL_PENDENTES',
  'TOTAL_VENCIDOS',
  'PERCENTUAL_CIENCIA',
  '%PENDENTE'
];

function atualizarPendenciasAvops() {
  return reconstruirPendenciasAvops_({ backup: true });
}

function reconstruirPendenciasAvops_(opts) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const backup = !opts || opts.backup !== false;

  if (backup) {
    backupSheetForHistory_(ss, SHEET_PENDENCIAS);
    backupSheetForHistory_(ss, SHEET_PENDENCIAS_RESUMO);
  }

  const { values: efetivo, header: eh } = getTable_(SHEET_EFETIVO);
  const { values: avops, header: ah } = getTable_(SHEET_AVOPS);
  const { values: leituras, header: lh } = getTable_(SHEET_LEITURAS);

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
  const l_timestamp = findOptionalHeaderIndex_(lh, 'TIMESTAMP');

  const leiturasMap = new Map();
  for (let i = 1; i < leituras.length; i++) {
    const avopKey = normalizarAvopIdParaComparacao_(leituras[i][l_av]);
    const id = normalizeUpper_(leituras[i][l_id]);
    if (!avopKey || !id) continue;
    const timestamp = l_timestamp >= 0 ? leituras[i][l_timestamp] : '';
    leiturasMap.set(`${avopKey}|${id}`, timestamp || true);
  }

  const hoje = stripTime_(new Date());
  const rows = [];
  const resumo = new Map();

  for (let i = 1; i < avops.length; i++) {
    const avopId = normalize_(avops[i][a_id]);
    const titulo = normalize_(avops[i][a_titulo]);
    const dataEmissao = toDateOrNull_(avops[i][a_data]);
    const prazoDias = Number(avops[i][a_prazo] || 30);
    const webUrl = normalize_(avops[i][a_web]) || buildWebAppUrl_(getWebAppBaseUrl_(), avopId);
    const statusAvop = normalizeUpper_(avops[i][a_status]);
    const perfilAlvo = normalizeUpper_(avops[i][a_perfil]);
    const exigeCiencia = normalizeUpper_(avops[i][a_exige]);

    if (!avopId || !dataEmissao) continue;
    if (statusAvop !== 'ATIVO') continue;
    if (exigeCiencia !== 'SIM') continue;

    const avopKey = normalizarAvopIdParaComparacao_(avopId);
    const vencimento = new Date(dataEmissao);
    vencimento.setDate(vencimento.getDate() + prazoDias);

    const itemResumo = {
      avopId,
      titulo,
      aplicaveis: 0,
      cientes: 0,
      pendentes: 0,
      vencidos: 0
    };

    for (let j = 1; j < efetivo.length; j++) {
      const ativo = normalizeUpper_(efetivo[j][e_ativo]) === 'SIM';
      if (!ativo) continue;

      const id = normalizeUpper_(efetivo[j][e_id]);
      const nome = normalize_(efetivo[j][e_nome]);
      const email = normalize_(efetivo[j][e_email]);
      const perfisUsuario = getPerfisFromEfetivoRow_(eh, efetivo[j]);

      if (!id || !perfisUsuario) continue;
      if (!perfilAlvoIncluiPerfil_(perfilAlvo, perfisUsuario)) continue;

      const leitura = leiturasMap.get(`${avopKey}|${id}`);
      const status = leitura ? 'CIENTE' : 'PENDENTE';
      const vencido = status === 'PENDENTE' && hoje > stripTime_(vencimento) ? 'SIM' : 'NAO';
      const diasDesde = Math.max(0, Math.floor((hoje.getTime() - stripTime_(dataEmissao).getTime()) / 86400000));

      itemResumo.aplicaveis++;
      if (status === 'CIENTE') itemResumo.cientes++;
      if (status === 'PENDENTE') itemResumo.pendentes++;
      if (vencido === 'SIM') itemResumo.vencidos++;

      rows.push([
        avopId,
        titulo,
        dataEmissao,
        id,
        nome,
        email,
        'SIM',
        perfisUsuario,
        statusAvop,
        perfilAlvo,
        exigeCiencia,
        status,
        diasDesde,
        prazoDias,
        vencido,
        webUrl,
        status === 'PENDENTE' ? calcularProximaCobrancaData_(dataEmissao, hoje) : ''
      ]);
    }

    resumo.set(avopId, itemResumo);
  }

  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[4]).localeCompare(String(b[4])));
  escreverTabela_(ss, SHEET_PENDENCIAS, PENDENCIAS_HEADERS_, rows);

  const resumoRows = Array.from(resumo.values()).map(item => {
    const percentualCiencia = item.aplicaveis ? item.cientes / item.aplicaveis : 0;
    const percentualPendente = item.aplicaveis ? item.pendentes / item.aplicaveis : 0;
    return [
      item.avopId,
      item.titulo,
      item.aplicaveis,
      item.cientes,
      item.pendentes,
      item.vencidos,
      percentualCiencia,
      percentualPendente
    ];
  });
  escreverTabela_(ss, SHEET_PENDENCIAS_RESUMO, PENDENCIAS_RESUMO_HEADERS_, resumoRows);

  return {
    ok: true,
    pendencias: rows.length,
    avops: resumoRows.length,
    msg: `Pendencias atualizadas: ${rows.length} vinculos em ${resumoRows.length} AVOPs.`
  };
}

function escreverTabela_(ss, sheetName, headers, rows) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function backupSheetForHistory_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() === 0) return;

  const tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd_HHmmss');
  const backupName = `${sheetName}_BKP_${stamp}`;
  sh.copyTo(ss).setName(backupName);
}

function normalizarAvopIdParaComparacao_(value) {
  const raw = normalizeUpper_(value);
  if (!raw) return '';

  let m = raw.match(/^AVOP\D*(\d{2})\D*(\d{4})$/);
  if (m) return `AVOP ${m[1]}-${m[2]}`;

  m = raw.match(/^AVOP\D*(\d{4})\D*(\d{2})$/);
  if (m) return `AVOP ${m[2]}-${m[1]}`;

  return raw.replace(/\s+/g, ' ');
}

function toDateOrNull_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function stripTime_(dateValue) {
  const d = new Date(dateValue);
  d.setHours(0, 0, 0, 0);
  return d;
}

function calcularProximaCobrancaData_(dataEmissao, hoje) {
  const emissao = stripTime_(dataEmissao);
  const atual = stripTime_(hoje);
  const marco = Math.max(0, calcularMarcoCobranca_(emissao, atual, INTERVALO_COBRANCA_DIAS));
  const proxima = new Date(emissao);
  proxima.setDate(proxima.getDate() + (marco + 1) * INTERVALO_COBRANCA_DIAS);
  return proxima;
}
