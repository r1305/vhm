function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteRootPaths(html, base) {
  const b = base.replace(/\/$/, '');
  const baseSegment = escapeRegex(b.replace(/^\//, ''));
  const pattern = new RegExp(`(href|action|src)="/(?!${baseSegment}/|/)`, 'g');
  return html.replace(pattern, `$1="${b}/`);
}

module.exports = { rewriteRootPaths };
