/****************
 * AUTENTICACAO
 ****************/
function getAuthSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('AUTH_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + '|' + new Date().toISOString();
    props.setProperty('AUTH_SECRET', secret);
  }
  return secret;
}

function encodeTokenPart_(obj) {
  return Utilities.base64EncodeWebSafe(JSON.stringify(obj), Utilities.Charset.UTF_8);
}

function decodeTokenPart_(tokenPart) {
  const json = Utilities.newBlob(
    Utilities.base64DecodeWebSafe(String(tokenPart || '')),
    'application/json'
  ).getDataAsString('UTF-8');
  return JSON.parse(json);
}

function signTokenPayload_(payloadEncoded) {
  const bytes = Utilities.computeHmacSha256Signature(payloadEncoded, getAuthSecret_());
  return Utilities.base64EncodeWebSafe(bytes);
}

function gerarTokenSessao_(idUpper) {
  const payload = {
    id: normalizeUpper_(idUpper),
    exp: Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000,
    nonce: Utilities.getUuid()
  };
  const payloadEncoded = encodeTokenPart_(payload);
  const signature = signTokenPayload_(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

function validarTokenSessao_(token) {
  const raw = String(token || '').trim();
  if (!raw || !raw.includes('.')) return { ok: false, msg: 'Sessao ausente ou invalida.' };

  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, msg: 'Formato de sessao invalido.' };

  const payloadEncoded = parts[0];
  const signature = parts[1];
  if (signTokenPayload_(payloadEncoded) !== signature) {
    return { ok: false, msg: 'Assinatura da sessao invalida.' };
  }

  let payload;
  try {
    payload = decodeTokenPart_(payloadEncoded);
  } catch (err) {
    return { ok: false, msg: 'Nao foi possivel validar a sessao.' };
  }

  const id = normalizeUpper_(payload?.id);
  const exp = Number(payload?.exp || 0);
  if (!id || !exp) return { ok: false, msg: 'Sessao incompleta.' };
  if (Date.now() > exp) return { ok: false, msg: 'Sessao expirada. Informe seu trigrama novamente.' };

  const validacao = validarIdAtivo_(id);
  if (!validacao.ok) return { ok: false, msg: 'Trigrama da sessao nao encontrado no efetivo.' };
  if (!validacao.ativo) return { ok: false, msg: 'Trigrama da sessao consta como INATIVO.' };

  return { ok: true, id, exp };
}

function getAccessLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_ACESSOS_LOG);
  if (!sh) {
    sh = ss.insertSheet(SHEET_ACESSOS_LOG);
    sh.appendRow(['TIMESTAMP', 'ID', 'MODULO', 'ACAO', 'DETALHE', 'STATUS']);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(['TIMESTAMP', 'ID', 'MODULO', 'ACAO', 'DETALHE', 'STATUS']);
  }
  return sh;
}

function registrarAcesso_(id, modulo, acao, detalhe, status) {
  try {
    const sh = getAccessLogSheet_();
    sh.appendRow([new Date(), normalizeUpper_(id), normalizeUpper_(modulo), normalizeUpper_(acao), normalize_(detalhe), normalizeUpper_(status)]);
  } catch (err) {}
}

function getAuthContext_(token, modulo, acao, detalhe) {
  const sessao = validarTokenSessao_(token);
  if (!sessao.ok) {
    registrarAcesso_('', modulo || 'SISTEMA', acao || 'ACESSO_NEGADO', detalhe || '', 'NEGADO');
    return sessao;
  }
  registrarAcesso_(sessao.id, modulo || 'SISTEMA', acao || 'ACESSO', detalhe || '', 'OK');
  return sessao;
}

function autenticarTrigrama(payload) {
  const id = normalizeUpper_(payload?.id);
  if (!id) return { ok: false, msg: 'Informe seu Trigrama.' };

  const validacao = validarIdAtivo_(id);
  if (!validacao.ok) {
    registrarAcesso_(id, 'SISTEMA', 'LOGIN', 'Trigrama nao encontrado', 'NEGADO');
    return { ok: false, msg: 'Trigrama nao encontrado no efetivo.' };
  }
  if (!validacao.ativo) {
    registrarAcesso_(id, 'SISTEMA', 'LOGIN', 'Trigrama inativo', 'NEGADO');
    return { ok: false, msg: 'Trigrama consta como INATIVO.' };
  }

  const perfil = getPerfilEfetivo_(id);
  const token = gerarTokenSessao_(id);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  registrarAcesso_(id, 'SISTEMA', 'LOGIN', 'Sessao emitida', 'OK');

  return { ok: true, msg: 'Sessao iniciada com sucesso.', token, id, perfil: perfil.perfil || '', expiresAt };
}

function validarSessao(payload) {
  return validarTokenSessao_(payload?.token);
}

function splitPerfilList_(value) {
  return normalizeUpper_(value)
    .replace(/\s+E\s+/g, ',')
    .replace(/[;|\/]/g, ',')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function expandPerfilSet_(value) {
  const aliasMap = {
    PILOTO: ['PILOTO', 'PILOTOS'],
    PILOTOS: ['PILOTO', 'PILOTOS'],
    TRIPULANTE: ['TRIPULANTE', 'TRIPULANTES', 'TRIPULACAO', 'TRIPULACAO OPERACIONAL'],
    TRIPULANTES: ['TRIPULANTE', 'TRIPULANTES', 'TRIPULACAO', 'TRIPULACAO OPERACIONAL'],
    HSAR: ['HSAR']
  };

  const set = new Set();
  splitPerfilList_(value).forEach(item => {
    (aliasMap[item] || [item]).forEach(alias => set.add(alias));
  });
  return set;
}

function perfilAlvoIncluiPerfil_(perfilAlvo, perfilPessoa) {
  const alvos = splitPerfilList_(perfilAlvo);
  if (!alvos.length) return false;
  if (alvos.includes('TODOS')) return true;

  const perfisPessoa = expandPerfilSet_(perfilPessoa);
  return alvos.some(alvo => perfisPessoa.has(alvo));
}

function publicoIncluiPerfil_(publico, perfil) {
  return perfilAlvoIncluiPerfil_(publico, perfil);
}

function calcularStatusFinal_(status, cienciaMaterial) {
  const st = normalizeUpper_(status);
  const cm = normalizeUpper_(cienciaMaterial);
  if (st === 'PRESENTE') return 'PRESENTE';
  if (st === 'JUSTIFICADO') return cm === 'SIM' ? 'JUSTIFICADO COM CIENCIA' : 'JUSTIFICADO SEM CIENCIA';
  if (st === 'AUSENTE') return 'AUSENTE';
  return 'PENDENTE';
}

function validarIdAtivo_(id) {
  const { values: ef, header: eh } = getTable_(SHEET_EFETIVO);
  const e_id = findHeaderIndex_(eh, 'ID');
  const e_ativo = findHeaderIndex_(eh, 'ATIVO');
  for (let i = 1; i < ef.length; i++) {
    if (normalizeUpper_(ef[i][e_id]) === id) {
      return { ok: true, ativo: normalizeUpper_(ef[i][e_ativo]) === 'SIM' };
    }
  }
  return { ok: false, ativo: false };
}

function getPerfilEfetivo_(idUpper) {
  const { values: ef, header: eh } = getTable_(SHEET_EFETIVO);
  const e_id = findHeaderIndex_(eh, 'ID');
  const e_ativo = findHeaderIndex_(eh, 'ATIVO');
  for (let i = 1; i < ef.length; i++) {
    if (normalizeUpper_(ef[i][e_id]) === idUpper) {
      const perfis = getPerfisFromEfetivoRow_(eh, ef[i]);
      return { ok: true, ativo: normalizeUpper_(ef[i][e_ativo]) === 'SIM', perfil: perfis, perfis };
    }
  }
  return { ok: false, ativo: false, perfil: '', perfis: '' };
}

function getPerfisFromEfetivoRow_(header, row) {
  const e_perfis = findOptionalHeaderIndex_(header, 'PERFIS');
  const e_perfilLegado = findOptionalHeaderIndex_(header, 'PERFIL');

  const perfis = e_perfis >= 0 ? normalizeUpper_(row[e_perfis]) : '';
  if (perfis) return splitPerfilList_(perfis).join(',');

  const perfilLegado = e_perfilLegado >= 0 ? normalizeUpper_(row[e_perfilLegado]) : '';
  return splitPerfilList_(perfilLegado).join(',');
}
