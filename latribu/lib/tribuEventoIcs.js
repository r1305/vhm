/**
 * Genera un archivo iCalendar (.ics) para un evento de La Tribu (hora America/Lima).
 */

function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function fmtHoraHm(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(parseInt(m[1], 10)).padStart(2, '0')}${m[2]}`;
}

function ymdToIcsDate(ymd) {
  return String(ymd).slice(0, 10).replace(/-/g, '');
}

function addMinutesToHm(hm, minutes) {
  const h = parseInt(hm.slice(0, 2), 10);
  const min = parseInt(hm.slice(2, 4), 10);
  const total = h * 60 + min + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}${String(nm).padStart(2, '0')}`;
}

function foldLine(line) {
  const max = 73;
  if (line.length <= max) return line;
  let out = line.slice(0, max);
  let rest = line.slice(max);
  while (rest.length) {
    out += `\r\n ${rest.slice(0, max - 1)}`;
    rest = rest.slice(max - 1);
  }
  return out;
}

/**
 * @param {object} ev — fila tribu_eventos (fecha, hora_inicio, hora_fin, nombre, lugar, ubicacion)
 * @param {{ uidHost?: string, calUrl?: string }} opts
 */
function buildEventIcs(ev, opts = {}) {
  const host = (opts.uidHost || 'latribu.local').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const uid = `tribu-evento-${ev.id}@${host}`;
  const ymd = ymdToIcsDate(ev.fecha);
  const startHm = fmtHoraHm(ev.hora_inicio) || '1900';
  let endHm = fmtHoraHm(ev.hora_fin);
  if (!endHm) endHm = addMinutesToHm(startHm, 60);

  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VHM La Tribu//Calendario//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:America/Lima',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0500',
    'TZNAME:-05',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=America/Lima:${ymd}T${startHm}00`,
    `DTEND;TZID=America/Lima:${ymd}T${endHm}00`,
    foldLine(`SUMMARY:${icsEscape(ev.nombre || 'Encuentro La Tribu')}`),
  ];

  const loc = [ev.lugar, ev.ubicacion].filter(Boolean).join(' — ');
  if (loc) lines.push(foldLine(`LOCATION:${icsEscape(loc)}`));

  const descParts = ['Encuentro de La Tribu. Horario: America/Lima (GMT−5).'];
  if (ev.ubicacion) descParts.push(ev.ubicacion);
  if (opts.calUrl) descParts.push(opts.calUrl);
  lines.push(foldLine(`DESCRIPTION:${icsEscape(descParts.join('\\n'))}`));
  if (opts.calUrl) lines.push(foldLine(`URL:${icsEscape(opts.calUrl)}`));

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = { buildEventIcs };
