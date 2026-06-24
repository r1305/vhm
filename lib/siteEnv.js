/** Lee variables de entorno con prefijo opcional (compatibilidad monorepo). */
function siteEnv(name) {
  const prefix = process.env.APP_SITE_PREFIX || '';
  const prefixed = prefix ? `${prefix}${name}` : '';
  const v = prefixed ? process.env[prefixed] : undefined;
  if (v != null && v !== '') return v;
  const fallback = process.env[name];
  if (fallback != null && fallback !== '') return fallback;
  throw new Error(`Missing env: ${prefixed || name}`);
}

function optionalSiteEnv(name, defaultValue) {
  try {
    return siteEnv(name);
  } catch {
    return defaultValue;
  }
}

module.exports = { siteEnv, optionalSiteEnv };
