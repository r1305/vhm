const env = require('./env');

function siteEnv(name) {
  const v = env(name);
  if (v != null && v !== '') return v;
  throw new Error(`Missing env: ${env.prefijo}${name}`);
}

function optionalSiteEnv(name, defaultValue) {
  try {
    return siteEnv(name);
  } catch {
    return defaultValue;
  }
}

module.exports = { siteEnv, optionalSiteEnv };
