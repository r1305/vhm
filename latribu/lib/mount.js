function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteRootPaths(html, base) {
  const b = base.replace(/\/$/, '');
  const baseSegment = escapeRegex(b.replace(/^\//, ''));
  const pattern = new RegExp(`(href|action|src)="/(?!${baseSegment}/|/)`, 'g');
  return html.replace(pattern, `$1="${b}/`);
}

const env = require('./env');
let basePathFijo = null;

function setBasePath(p) {
  basePathFijo = String(p || '').replace(/\/$/, '');
}

function basePath() {
  return basePathFijo ?? (env('APP_MOUNT_PATH') || '/latribu');
}

module.exports = { rewriteRootPaths, setBasePath, basePath };
