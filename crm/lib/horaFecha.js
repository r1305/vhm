const normHora = (v) => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(String(v ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}` : null;
};

const sumarHora = (h) => {
  const [hh, mm, ss] = h.split(':').map(Number);
  return hh >= 23 ? null : `${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const fechaValida = (f) => {
  if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(f + 'T00:00:00-05:00');
  if (isNaN(d)) return false;
  const [y, m, dia] = f.split('-').map(Number);
  const u = new Date(Date.UTC(y, m - 1, dia));
  return u.getUTCFullYear() === y && u.getUTCMonth() === m - 1 && u.getUTCDate() === dia;
};

module.exports = { normHora, sumarHora, fechaValida };
