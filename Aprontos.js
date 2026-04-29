/**************
 * APRONTOS
 **************/
function getAprontoById_(aprontoId) {
  const { values, header } = getTable_(SHEET_APRONTOS);
  const a_id = findHeaderIndex_(header, 'APRONTO_ID');
  const a_titulo = findHeaderIndex_(header, 'TITULO');
  const a_data = findHeaderIndex_(header, 'DATA');
  const a_publico = findAprontoPerfilAlvoIndex_(header);
  const a_status = findHeaderIndex_(header, 'STATUS');
  const a_link = findHeaderIndex_(header, 'LINK_MATERIAL');
  const a_exige = findHeaderIndex_(header, 'EXIGE_CIENCIA_MATERIAL');

  for (let i = 1; i < values.length; i++) {
    if (normalize_(values[i][a_id]) !== normalize_(aprontoId)) continue;
    const dt = new Date(values[i][a_data]);
    return {
      aprontoId: normalize_(values[i][a_id]),
      titulo: normalize_(values[i][a_titulo]),
      data: dt.toLocaleDateString('pt-BR'),
      publico: getAprontoPerfilAlvoFromRow_(header, values[i], a_publico),
      status: normalizeUpper_(values[i][a_status]),
      linkMaterial: toDriveDownloadUrl_(values[i][a_link]),
      exigeCienciaMaterial: normalizeUpper_(values[i][a_exige])
    };
  }
  throw new Error(`Apronto nao encontrado: ${aprontoId}`);
}

function getAprontoAccessContext_(aprontoId, id, options) {
  const opts = options || {};
  const idUpper = normalizeUpper_(id);
  const aprId = normalize_(aprontoId);
  if (!aprId || !idUpper) return { ok: false, msg: 'Informe apronto e Trigrama.' };

  const validacao = validarIdAtivo_(idUpper);
  if (!validacao.ok) return { ok: false, msg: 'Trigrama nao encontrado no efetivo.' };
  if (!validacao.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.' };

  const apronto = getAprontoById_(aprId);
  const perfil = getPerfilEfetivo_(idUpper);
  if (!perfil.ok || !perfil.ativo || !perfil.perfil) {
    return { ok: false, msg: 'PERFIL nao definido para este Trigrama.' };
  }
  if (!publicoIncluiPerfil_(apronto.publico, perfil.perfil)) {
    return { ok: false, msg: 'Seu perfil nao possui acesso a este apronto.' };
  }
  if (opts.requireOpen && apronto.status === 'FECHADO') {
    return { ok: false, msg: opts.closedMsg || 'Apronto fechado.' };
  }
  if (opts.requireMaterialScience && apronto.exigeCienciaMaterial !== 'SIM') {
    return { ok: false, msg: 'Este apronto nao exige ciencia formal do material.' };
  }
  return { ok: true, id: idUpper, perfil: perfil.perfil, apronto };
}

function renderAprontoPage_(aprontoId, token, fallbackBaseUrl) {
  const auth = getAuthContext_(token, 'APR', 'ABRIR_PAGINA', aprontoId);
  if (!auth.ok) return HtmlService.createHtmlOutput(auth.msg);

  const access = getAprontoAccessContext_(aprontoId, auth.id);
  if (!access.ok) {
    registrarAcesso_(auth.id, 'APR', 'ABRIR_PAGINA', `${aprontoId} sem perfil`, 'NEGADO');
    return HtmlService.createHtmlOutput(access.msg);
  }

  const apronto = access.apronto;
  const t = HtmlService.createTemplateFromFile('Apronto');
  t.aprontoId = apronto.aprontoId;
  t.titulo = apronto.titulo;
  t.data = apronto.data;
  t.publico = apronto.publico;
  t.status = apronto.status;
  t.linkMaterial = apronto.linkMaterial;
  t.exigeCienciaMaterial = apronto.exigeCienciaMaterial;
  t.baseUrl = getBaseWebAppUrl_(fallbackBaseUrl);
  t.token = token;
  t.authId = auth.id;

  return t.evaluate().setTitle(`Apronto - ${apronto.aprontoId}`).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function registrarPresenca(payload) {
  const auth = getAuthContext_(payload?.token, 'APR', 'REGISTRAR_PRESENCA', payload?.aprontoId);
  if (!auth.ok) return { ok: false, msg: auth.msg };

  const aprontoId = normalize_(payload?.aprontoId);
  const id = auth.id;
  const access = getAprontoAccessContext_(aprontoId, id, { requireOpen: true, closedMsg: 'Apronto fechado para registro de presenca.' });
  if (!access.ok) return { ok: false, msg: access.msg };

  const { sh: prSh, header: ph } = getTable_(SHEET_PRESENCAS);
  const p_ap = findHeaderIndex_(ph, 'APRONTO_ID');
  const p_id = findHeaderIndex_(ph, 'ID');
  const p_st = findHeaderIndex_(ph, 'STATUS');

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const prVals = prSh.getDataRange().getValues();
    for (let i = 1; i < prVals.length; i++) {
      if (normalize_(prVals[i][p_ap]) === aprontoId && normalizeUpper_(prVals[i][p_id]) === id) {
        prSh.getRange(i + 1, p_st + 1).setValue('PRESENTE');
        SpreadsheetApp.flush();
        return { ok: true, msg: 'Presenca registrada.' };
      }
    }
    const novaLinha = [new Date(), aprontoId, id, 'PRESENTE', '', '', ''];
    const novaLinhaNum = getFirstEmptyRow_(prSh, 2, 2);
    prSh.getRange(novaLinhaNum, 1, 1, novaLinha.length).setValues([novaLinha]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, msg: 'Presenca registrada.' };
}

function justificarAusencia(payload) {
  const auth = getAuthContext_(payload?.token, 'APR', 'JUSTIFICAR_AUSENCIA', payload?.aprontoId);
  if (!auth.ok) return { ok: false, msg: auth.msg };

  const aprontoId = normalize_(payload?.aprontoId);
  const id = auth.id;
  const obs = normalize_(payload?.obs || 'escala');
  const access = getAprontoAccessContext_(aprontoId, id, { requireOpen: true, closedMsg: 'Apronto fechado para justificativa.' });
  if (!access.ok) return { ok: false, msg: access.msg };

  const { sh: prSh, header: ph } = getTable_(SHEET_PRESENCAS);
  const p_ap = findHeaderIndex_(ph, 'APRONTO_ID');
  const p_id = findHeaderIndex_(ph, 'ID');
  const p_st = findHeaderIndex_(ph, 'STATUS');
  const p_obs = findHeaderIndex_(ph, 'OBS');

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const prVals = prSh.getDataRange().getValues();
    for (let i = 1; i < prVals.length; i++) {
      if (normalize_(prVals[i][p_ap]) === aprontoId && normalizeUpper_(prVals[i][p_id]) === id) {
        prSh.getRange(i + 1, p_st + 1).setValue('JUSTIFICADO');
        prSh.getRange(i + 1, p_obs + 1).setValue(obs);
        SpreadsheetApp.flush();
        return { ok: true, msg: 'Ausencia justificada.' };
      }
    }
    const novaLinha = [new Date(), aprontoId, id, 'JUSTIFICADO', obs, '', ''];
    const novaLinhaNum = getFirstEmptyRow_(prSh, 2, 2);
    prSh.getRange(novaLinhaNum, 1, 1, novaLinha.length).setValues([novaLinha]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, msg: 'Ausencia justificada.' };
}

function registrarCienciaMaterial(payload) {
  const auth = getAuthContext_(payload?.token, 'APR', 'REGISTRAR_CIENCIA_MATERIAL', payload?.aprontoId);
  if (!auth.ok) return { ok: false, msg: auth.msg };

  const aprontoId = normalize_(payload?.aprontoId);
  const id = auth.id;
  const access = getAprontoAccessContext_(aprontoId, id, { requireMaterialScience: true });
  if (!access.ok) return { ok: false, msg: access.msg };

  const { sh: prSh, header: ph } = getTable_(SHEET_PRESENCAS);
  const p_ap = findHeaderIndex_(ph, 'APRONTO_ID');
  const p_id = findHeaderIndex_(ph, 'ID');
  const p_ciencia = findHeaderIndex_(ph, 'CIENCIA_MATERIAL');

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const prVals = prSh.getDataRange().getValues();
    for (let i = 1; i < prVals.length; i++) {
      if (normalize_(prVals[i][p_ap]) === aprontoId && normalizeUpper_(prVals[i][p_id]) === id) {
        prSh.getRange(i + 1, p_ciencia + 1).setValue('SIM');
        SpreadsheetApp.flush();
        return { ok: true, msg: 'Ciencia do material registrada.' };
      }
    }
    const novaLinha = [new Date(), aprontoId, id, '', '', 'SIM', ''];
    const novaLinhaNum = getFirstEmptyRow_(prSh, 2, 2);
    prSh.getRange(novaLinhaNum, 1, 1, novaLinha.length).setValues([novaLinha]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, msg: 'Ciencia do material registrada.' };
}

function getCentralAprontos(params) {
  const auth = getAuthContext_(params?.token, 'APR', 'CONSULTA', params?.status || 'ABERTOS');
  if (!auth.ok) return { ok: false, msg: auth.msg, items: [] };

  const id = auth.id;
  const dias = Number(params?.dias || 90);
  const statusFiltro = normalizeUpper_(params?.status || 'ABERTOS');
  const busca = normalize_(params?.busca || '').toLowerCase();

  const v = getPerfilEfetivo_(id);
  if (!v.ok) return { ok: false, msg: 'Trigrama nao encontrado no efetivo.', items: [] };
  if (!v.ativo) return { ok: false, msg: 'Trigrama consta como INATIVO.', items: [] };
  if (!v.perfil) return { ok: false, msg: 'PERFIL nao definido para este Trigrama.', items: [] };

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
  const a_publico = findAprontoPerfilAlvoIndex_(ah);
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
    const publico = getAprontoPerfilAlvoFromRow_(ah, ap[i], a_publico);
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

  const pendentes = items.filter(x => x.statusApronto === 'ABERTO' && x.statusUsuario === 'PENDENTE').length;
  return { ok: true, items, pendentes };
}

function getStatusApronto_(aprontoId) {
  const { values: ap, header: ah } = getTable_(SHEET_APRONTOS);
  const a_id = findHeaderIndex_(ah, 'APRONTO_ID');
  const a_status = findHeaderIndex_(ah, 'STATUS');
  for (let i = 1; i < ap.length; i++) {
    if (normalize_(ap[i][a_id]) === aprontoId) return normalizeUpper_(ap[i][a_status]);
  }
  return '';
}

function findAprontoPerfilAlvoIndex_(header) {
  const idxPerfilAlvo = findOptionalHeaderIndex_(header, 'PERFIL_ALVO');
  if (idxPerfilAlvo >= 0) return idxPerfilAlvo;
  return findHeaderIndex_(header, 'PUBLICO');
}

function getAprontoPerfilAlvoFromRow_(header, row, preferredIndex) {
  const idxPerfilAlvo = findOptionalHeaderIndex_(header, 'PERFIL_ALVO');
  const idxPublico = findOptionalHeaderIndex_(header, 'PUBLICO');

  if (idxPerfilAlvo >= 0) {
    const perfilAlvo = normalizeUpper_(row[idxPerfilAlvo]);
    if (perfilAlvo) return perfilAlvo;
  }

  if (idxPublico >= 0) return normalizeUpper_(row[idxPublico]);
  return normalizeUpper_(row[preferredIndex]);
}
