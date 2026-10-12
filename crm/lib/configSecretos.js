const MASCARA = '••••';

const CLAVES_SECRETAS = new Set([
  'smtp_pass',
  'openwa_api_key',
  'openwa_webhook_token',
  'sms_gateway_token',
  'google_tokens',
  'google_client_secret',
]);

const PATRON_SECRETO = /(pass|secret|token|api_key|apikey|private)/i;

function esSecreto(clave) {
  return CLAVES_SECRETAS.has(clave) || PATRON_SECRETO.test(String(clave || ''));
}

function esValorJson(clave, v) {
  if (clave === 'google_tokens') return true;
  const c = v.trim().charAt(0);
  return c === '{' || c === '[';
}

function enmascarar(valor, clave) {
  const v = valor == null ? '' : String(valor);
  if (!v) return '';
  if (esValorJson(clave, v)) return MASCARA;
  return MASCARA + (v.length > 8 ? v.slice(-4) : '');
}

function esMascara(valor) {
  return typeof valor === 'string' && valor.trim().startsWith(MASCARA);
}

function configParaCliente(rows) {
  const data = {};
  for (const r of rows) {
    const valor = r.valor || '';
    if (esSecreto(r.clave)) {
      data[r.clave] = enmascarar(valor, r.clave);
      data[`${r.clave}_configurada`] = !!valor;
    } else {
      data[r.clave] = valor;
    }
  }
  return data;
}

module.exports = { MASCARA, esSecreto, enmascarar, esMascara, configParaCliente };
