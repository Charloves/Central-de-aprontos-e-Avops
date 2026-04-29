/***********
 * AVOPS
 ***********/
function getAvopById_(avopId) {
  const { values, header } = getTable_(SHEET_AVOPS);
  const a_id = findHeaderIndex_(header, 'AVOP_ID');
  const a_titulo = findHeaderIndex_(header, 'TITULO');
  let a_pdf = -1;
  try {
    a_pdf = findHeaderIndex_(header, 'LINK_PDF');
  } catch (err) {
    a_pdf = findHeaderIndex_(header, 'PDF_URL');
  }
  const a_status = findHeaderIndex_(header, 'STATUS');

  for (let i = 1; i < values.length; i++) {
    if (normalize_(values[i][a_id]) !== normalize_(avopId)) continue;
    if (normalizeUpper_(values[i][a_status]) !== 'ATIVO') {
      throw new Error(`AVOP encontrado, mas nao esta ATIVO: ${avopId}`);
    }
    return {
      avopId: normalize_(values[i][a_id]),
      titulo: normalize_(values[i][a_titulo]),
      pdfUrl: toDrivePreviewUrl_(values[i][a_pdf])
    };
  }

  throw new Error(`AVOP nao encontrado: ${avopId}`);
}

function renderAvopPage_(avopId, token, fallbackBaseUrl, autoOpen, returnParams) {
  const auth = getAuthContext_(token, 'AVOP', 'ABRIR_PAGINA', avopId);
  if (!auth.ok) return HtmlService.createHtmlOutput(auth.msg);

  const avop = getAvopById_(avopId);
  const t = HtmlService.createTemplateFromFile('Index');
  t.avopId = avop.avopId;
  t.titulo = avop.titulo;
  t.pdfUrl = avop.pdfUrl;
  t.baseUrl = getBaseWebAppUrl_(fallbackBaseUrl);
  t.token = token;
  t.authId = auth.id;
  t.autoOpen = normalize_(autoOpen) === '1' ? '1' : '';
  t.returnAba = normalize_(returnParams?.aba || 'AVOP') || 'AVOP';
  t.returnId = normalize_(returnParams?.id || auth.id) || auth.id;
  t.returnBusca = normalize_(returnParams?.busca || '');
  t.returnAvopStatus = normalize_(returnParams?.avopStatus || 'TODOS') || 'TODOS';

  return t.evaluate()
    .setTitle(`AVOP - ${avop.avopId}`)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function registrarLeitura(payload) {
  const auth = getAuthContext_(payload?.token, 'AVOP', 'REGISTRAR_LEITURA', payload?.avopId);
  if (!auth.ok) return { ok: false, msg: auth.msg };

  const avopId = normalize_(payload?.avopId);
  const id = auth.id;
  const nomeInformado = normalize_(payload?.nome);
  if (!avopId) return { ok: false, msg: 'Informe AVOP.' };

  const validacao = validarIdAtivo_(id);
  if (!validacao.ok) return { ok: false, msg: 'Trigrama nao encontrado no efetivo.' };
  if (!validacao.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.' };

  const { sh: leitSh, header: lh } = getTable_(SHEET_LEITURAS);
  const l_av = findHeaderIndex_(lh, 'AVOP_ID');
  const l_id = findHeaderIndex_(lh, 'ID');

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const leitVals = leitSh.getDataRange().getValues();
    const avopKey = normalizarAvopIdParaComparacao_(avopId);
    for (let i = 1; i < leitVals.length; i++) {
      if (normalizarAvopIdParaComparacao_(leitVals[i][l_av]) === avopKey && normalizeUpper_(leitVals[i][l_id]) === id) {
        return { ok: true, msg: 'Leitura ja registrada. Abrindo AVOP...' };
      }
    }
    leitSh.appendRow([new Date(), avopId, id, nomeInformado, '', '']);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return { ok: true, msg: 'Leitura registrada. Abrindo AVOP...' };
}

function getCentralData(params) {
  const auth = getAuthContext_(params?.token, 'AVOP', 'CONSULTA', params?.status || 'PENDENTE');
  if (!auth.ok) return { ok: false, msg: auth.msg, items: [] };

  const id = auth.id;
  const statusFiltro = normalizeUpper_(params?.status || 'PENDENTE');
  const busca = normalize_(params?.busca || '').toLowerCase();
  const dias = Number(params?.dias || 90);

  const v = getPerfilEfetivo_(id);
  if (!v.ok) return { ok: false, msg: 'Trigrama nao encontrado no efetivo.', items: [] };
  if (!v.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.', items: [] };
  if (!v.perfil) return { ok: false, msg: 'PERFIL nao definido para este Trigrama.', items: [] };

  const { values: leituras, header: lh } = getTable_(SHEET_LEITURAS);
  const l_av = findHeaderIndex_(lh, 'AVOP_ID');
  const l_id = findHeaderIndex_(lh, 'ID');

  const lidas = new Set();
  for (let i = 1; i < leituras.length; i++) {
    if (normalizeUpper_(leituras[i][l_id]) === id) {
      lidas.add(normalizarAvopIdParaComparacao_(leituras[i][l_av]));
    }
  }

  const { values: avops, header: ah } = getTable_(SHEET_AVOPS);
  const a_id = findHeaderIndex_(ah, 'AVOP_ID');
  const a_titulo = findHeaderIndex_(ah, 'TITULO');
  const a_data = findHeaderIndex_(ah, 'DATA_EMISSAO');
  const a_prazo = findHeaderIndex_(ah, 'PRAZO_DIAS');
  const a_status = findHeaderIndex_(ah, 'STATUS');
  const a_perfil = findHeaderIndex_(ah, 'PERFIL_ALVO');
  const a_exige = findHeaderIndex_(ah, 'EXIGE_CIENCIA');

  const limite = new Date();
  limite.setDate(limite.getDate() - dias);
  const hoje = new Date();
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

    const ciente = lidas.has(normalizarAvopIdParaComparacao_(avopId));
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
