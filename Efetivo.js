/***********************
 * EFETIVO / PERFIS
 ***********************/
function prepararEfetivoPerfis() {
  const { sh, values, header } = getTable_(SHEET_EFETIVO);
  const e_perfil = findHeaderIndex_(header, 'PERFIL');
  let e_perfis = findOptionalHeaderIndex_(header, 'PERFIS');

  if (e_perfis < 0) {
    e_perfis = sh.getLastColumn();
    sh.getRange(1, e_perfis + 1).setValue('PERFIS');
  }

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const atual = normalizeUpper_(values[i][e_perfis]);
    const legado = normalizeUpper_(values[i][e_perfil]);
    out.push([atual || splitPerfilList_(legado).join(',')]);
  }

  if (out.length) {
    sh.getRange(2, e_perfis + 1, out.length, 1).setValues(out);
  }

  return {
    ok: true,
    coluna: e_perfis + 1,
    linhas: out.length,
    msg: `Coluna PERFIS preparada na coluna ${e_perfis + 1}.`
  };
}
