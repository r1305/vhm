/* calendario.js — guía #calendar (agenda semanal + vista mensual) */

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const CAL_FILTERS = [
  { id: 'all', label: 'Todo' },
  { id: 'sesiones', label: 'Sesiones', re: /sesión|claridad|acción|terapia|grupo/i },
  { id: 'social', label: 'Social', re: /conecta|social|fuera de la pantalla|conocer/i },
  { id: 'bienestar', label: 'Bienestar', re: /bienestar|calma|mindful|respir/i },
  { id: 'actividad', label: 'Actividad', re: /actividad|movimiento|cuerpo/i },
  { id: 'aprendizaje', label: 'Aprendizaje', re: /aprendizaje|taller|recurso|guía/i },
];

let eventosMes = [];
let eventosCache = [];
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let weekStartYmd = '';
let calWeekOffset = 0;
let calFilter = 'all';
let reservasIds = new Set();
let evtActualId = null;

function hoyLimaYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

function addDaysYmdLima(ymd, days) {
  const [y, mo, da] = String(ymd).slice(0, 10).split('-').map(Number);
  const utc = Date.UTC(y, mo - 1, da + days, 17, 0, 0);
  return new Date(utc).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

function isoWeekdayLima(ymd) {
  const short = new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', {
    timeZone: 'America/Lima',
    weekday: 'short',
  });
  const map = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] || 1;
}

function mondayOnOrBefore(ymd) {
  const iso = isoWeekdayLima(ymd);
  return addDaysYmdLima(ymd, -(iso - 1));
}

function fmtHora(t) { return t ? String(t).slice(0, 5) : ''; }

function duracionMinutos(ev) {
  if (!ev.hora_inicio || !ev.hora_fin) return 60;
  const a = fmtHora(ev.hora_inicio).split(':').map(Number);
  const b = fmtHora(ev.hora_fin).split(':').map(Number);
  return Math.max(30, (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]) || 60);
}

function fmtEventoWhen(ev) {
  const parts = [];
  if (ev.hora_inicio) {
    const h = fmtHora(ev.hora_inicio);
    const [hh, mm] = h.split(':').map(Number);
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    parts.push(d.toLocaleTimeString('es-PE', {
      timeZone: 'America/Lima',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' · Lima');
  }
  parts.push(`${duracionMinutos(ev)} min`);
  const host = ev.facilitador || ev.lugar || 'Equipo La Tribu';
  parts.push(host);
  return escapeHtml(parts.join(' · '));
}

function eventoEnSemana(ev, startYmd) {
  const endYmd = addDaysYmdLima(startYmd, 6);
  const f = String(ev.fecha).slice(0, 10);
  return f >= startYmd && f <= endYmd;
}

function eventoEsPasadoCliente(ev) {
  const f = String(ev.fecha).slice(0, 10);
  const hoy = hoyLimaYmd();
  if (f < hoy) return true;
  if (f > hoy) return false;
  const end = ev.hora_fin ? fmtHora(ev.hora_fin) : fmtHora(ev.hora_inicio);
  if (!end) return false;
  const now = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [eh, em] = end.split(':').map(Number);
  let mins = eh * 60 + em;
  if (!ev.hora_fin && ev.hora_inicio) mins += 60;
  const [nh, nm] = now.split(':').map(Number);
  return mins <= nh * 60 + nm;
}

function fmtFechaLarga(ymd) {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('es-PE', {
    timeZone: 'America/Lima',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

async function cargarReservas() {
  reservasIds = new Set();
  try {
    const res = await tribuFetch('/eventos/mis-reservas');
    if (!res.ok) return;
    const data = await res.json();
    (data.evento_ids || []).forEach(id => reservasIds.add(Number(id)));
  } catch { /* ignore */ }
}

function eventoMatchesFilter(ev) {
  if (calFilter === 'all') return true;
  const tipo = String(ev.tipo || '').toLowerCase();
  if (tipo && tipo !== 'otro') return tipo === calFilter;
  const def = CAL_FILTERS.find(x => x.id === calFilter);
  if (!def || !def.re) return true;
  const blob = `${ev.nombre} ${ev.lugar || ''} ${ev.descripcion || ''}`;
  return def.re.test(blob);
}

function renderWeekLabel() {
  const el = document.getElementById('calWeekLabel');
  const prev = document.getElementById('calWeekPrev');
  if (prev) prev.disabled = calWeekOffset <= 0;
  if (el) {
    el.textContent = calWeekOffset === 0 ? 'Próximos 7 días' : 'Próximas semanas';
  }
}

function eventCategoryLabel(ev) {
  const tipo = String(ev.tipo || '').toLowerCase();
  const map = {
    sesiones: 'Sesiones',
    social: 'Social',
    bienestar: 'Bienestar',
    actividad: 'Actividad',
    aprendizaje: 'Aprendizaje',
  };
  if (map[tipo]) return map[tipo];
  const blob = `${ev.nombre || ''} ${ev.lugar || ''} ${ev.descripcion || ''}`;
  for (const f of CAL_FILTERS) {
    if (f.id !== 'all' && f.re && f.re.test(blob)) return f.label;
  }
  return 'Sesiones';
}

function fmtEventTop(ymd) {
  const d = new Date(String(ymd).slice(0, 10) + 'T12:00:00');
  const dayNum = d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit' });
  const monthShort = d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', month: 'short' }).toUpperCase();
  const weekday = d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long' });
  return { dayNum, monthShort, weekday };
}

function renderTypeFilters() {
  const wrap = document.getElementById('calTypeFilters');
  if (!wrap) return;
  wrap.innerHTML = CAL_FILTERS.map(f =>
    `<button type="button" class="chip${calFilter === f.id ? ' active' : ''}" data-cal-filter="${f.id}" role="tab" aria-selected="${calFilter === f.id}">${f.label}</button>`
  ).join('');
  wrap.querySelectorAll('[data-cal-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      calFilter = btn.getAttribute('data-cal-filter');
      renderTypeFilters();
      renderWeekList();
    });
  });
}

function renderWeekList() {
  const list = document.getElementById('calWeekList');
  if (!list) return;
  const hoy = hoyLimaYmd();
  const weekEnd = addDaysYmdLima(weekStartYmd, 6);
  const minFecha = weekEnd >= hoy ? (hoy > weekStartYmd ? hoy : weekStartYmd) : weekStartYmd;
  const rows = eventosCache
    .filter(ev => eventoEnSemana(ev, weekStartYmd))
    .filter(ev => eventoMatchesFilter(ev))
    .filter(ev => {
      const f = String(ev.fecha).slice(0, 10);
      return f >= minFecha && f <= weekEnd;
    })
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora_inicio).localeCompare(String(b.hora_inicio)));

  if (!rows.length) {
    list.innerHTML =
      `<div class="cal-agenda-empty empty">` +
      `<h3>No hay eventos de este tipo en la agenda.</h3>` +
      `<p>${escapeHtml(window._calEmptyWeek || 'Puedes explorar otras actividades o cambiar de semana.')}</p>` +
      `<button type="button" class="cal-event-btn secondary cal-agenda-reset" data-cal-filter="all">Ver toda la agenda</button>` +
      `</div>`;
    list.querySelector('[data-cal-filter="all"]')?.addEventListener('click', () => {
      calFilter = 'all';
      renderTypeFilters();
      renderWeekList();
    });
    return;
  }
  list.innerHTML = rows.map(ev => {
    const ymd = String(ev.fecha).slice(0, 10);
    const top = fmtEventTop(ymd);
    const nombre = escapeHtml(ev.nombre || 'Encuentro');
    const desc = escapeHtml(ev.descripcion || ev.lugar || 'Un espacio para conectar y cuidarte.');
    const cat = escapeHtml(eventCategoryLabel(ev));
    const reservado = reservasIds.has(Number(ev.id));
    const pasado = eventoEsPasadoCliente(ev);
    const btnClass = reservado ? 'cal-event-btn secondary' : 'cal-event-btn';
    const btnLabel = reservado ? 'Lugar reservado ✓' : 'Reservar mi lugar';
    const meta = fmtEventoWhen(ev);
    return `<article class="cal-event${reservado ? ' is-reserved' : ''}">
      <div class="cal-event-top">
        <div class="cal-event-day">${top.dayNum}<small>${top.monthShort} · ${escapeHtml(top.weekday)}</small></div>
        <span class="cal-event-tag">${cat}</span>
      </div>
      <div class="cal-event-body">
        <h3>${nombre}</h3>
        <p class="cal-event-desc">${desc}</p>
        <p class="cal-event-meta">${meta}</p>
        ${pasado ? '' : `<button type="button" class="${btnClass}" onclick="verEvento(${ev.id})">${btnLabel}</button>`}
      </div>
    </article>`;
  }).join('');
}

function renderCalendario() {
  const grid = document.getElementById('calGrid');
  const dowEl = document.getElementById('calDow');
  const titulo = document.getElementById('calMesTitulo');
  if (!grid) return;

  titulo.textContent = `${MESES_ES[calMonth]} ${calYear}`;
  dowEl.innerHTML = DOW_ES.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const first = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth + 1, 0).getDate();
  let startDow = first.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const hoyStr = hoyLimaYmd();

  let html = '';
  for (let i = 0; i < startDow; i++) html += '<div class="cal-day other"></div>';
  for (let d = 1; d <= lastDay; d++) {
    const fechaStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const evs = eventosMes.filter(e => String(e.fecha).slice(0, 10) === fechaStr);
    const isToday = fechaStr === hoyStr;
    html += `<div class="cal-day${isToday ? ' today' : ''}">
      <div class="cal-day-num">${d}</div>
      <div class="cal-events-desktop">${evs.map(e => `<div class="cal-ev" onclick="verEvento(${e.id})">${escapeHtml(e.nombre)}</div>`).join('')}</div>
      <div class="cal-events-mobile">${evs.length ? `<div class="cal-icon" onclick="verEvento(${evs[0].id})"><span class="cal-icon-inner">📅</span>${evs.length > 1 ? `<span class="cal-badge">${evs.length}</span>` : ''}</div>` : ''}</div>
    </div>`;
  }
  grid.innerHTML = html;
}

function mergeEventosEnCache(rows) {
  if (!Array.isArray(rows)) return;
  const map = new Map(eventosCache.map(e => [e.id, e]));
  rows.forEach(e => map.set(e.id, e));
  eventosCache = [...map.values()];
}

function syncEventosMesDesdeCache() {
  const mes = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  eventosMes = eventosCache.filter(e => String(e.fecha).slice(0, 7) === mes);
}

async function fetchEventosMes(mes) {
  window._tribuLoaderStart();
  try {
    const res = await fetch(`${API}/eventos?mes=${mes}`);
    if (!res.ok) throw new Error();
    return await res.json();
  } finally {
    window._tribuLoaderEnd();
  }
}

async function cargarMes(mesOverride) {
  const loading = document.getElementById('calLoading');
  if (loading) {
    loading.style.display = 'block';
    loading.textContent = 'Cargando eventos…';
  }
  const mes = mesOverride || `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  try {
    const rows = await fetchEventosMes(mes);
    mergeEventosEnCache(rows);
    syncEventosMesDesdeCache();
    renderCalendario();
    renderWeekList();
    if (loading) loading.style.display = 'none';
  } catch {
    if (loading) loading.textContent = 'No se pudieron cargar los eventos.';
  }
}

async function ensureWeekEventsLoaded() {
  if (!weekStartYmd) weekStartYmd = mondayOnOrBefore(hoyLimaYmd());
  const end = addDaysYmdLima(weekStartYmd, 6);
  const months = new Set([weekStartYmd.slice(0, 7), end.slice(0, 7)]);
  try {
    for (const mes of months) {
      const rows = await fetchEventosMes(mes);
      mergeEventosEnCache(rows);
    }
    syncEventosMesDesdeCache();
    renderWeekList();
    const panel = document.getElementById('calContenido');
    if (panel && !panel.hidden) renderCalendario();
  } catch {
    const loading = document.getElementById('calLoading');
    if (loading) loading.textContent = 'No se pudieron cargar los eventos.';
  }
}

function cambiarMes(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  cargarMes();
}

function cambiarSemana(delta) {
  if (delta < 0 && calWeekOffset <= 0) return;
  calWeekOffset = Math.max(0, calWeekOffset + delta);
  weekStartYmd = addDaysYmdLima(mondayOnOrBefore(hoyLimaYmd()), calWeekOffset * 7);
  renderWeekLabel();
  ensureWeekEventsLoaded();
}

function actualizarModalReserva(ev) {
  const reservado = reservasIds.has(Number(ev.id));
  const pasado = eventoEsPasadoCliente(ev);
  const msg = document.getElementById('evtReserveMsg');
  const btn = document.getElementById('evtReserveBtn');
  const cancel = document.getElementById('evtCancelBtn');
  const ics = document.getElementById('evtIcsBtn');
  if (msg) {
    if (reservado) {
      msg.hidden = false;
      msg.textContent = 'Tu lugar está reservado. Añade el encuentro a tu calendario para no olvidarlo.';
    } else if (pasado) {
      msg.hidden = false;
      msg.textContent = 'Este encuentro ya pasó.';
    } else {
      msg.hidden = true;
      msg.textContent = '';
    }
  }
  if (btn) {
    btn.hidden = pasado || reservado;
    btn.disabled = false;
    btn.textContent = 'Reservar mi lugar';
  }
  if (cancel) cancel.hidden = !reservado;
  if (ics) ics.hidden = pasado;
}

function verEvento(id) {
  const ev = eventosCache.find(x => x.id === id) || eventosMes.find(x => x.id === id);
  if (!ev) return;
  evtActualId = Number(ev.id);
  const fin = ev.hora_fin ? ` – ${fmtHora(ev.hora_fin)}` : '';
  document.getElementById('evtNombre').textContent = ev.nombre;
  document.getElementById('evtFecha').textContent = fmtFechaLarga(String(ev.fecha).slice(0, 10));
  document.getElementById('evtHora').textContent = `${fmtHora(ev.hora_inicio)}${fin} · Lima`;
  document.getElementById('evtLugar').textContent = ev.lugar || '';
  const linkRow = document.getElementById('evtLinkRow');
  const linkEl = document.getElementById('evtLink');
  if (ev.ubicacion) {
    linkEl.href = ev.ubicacion;
    linkEl.textContent = ev.ubicacion;
    linkRow.style.display = 'flex';
  } else {
    linkRow.style.display = 'none';
  }
  actualizarModalReserva(ev);
  document.getElementById('evtOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}

async function reservarEventoActual() {
  if (!evtActualId) return;
  const btn = document.getElementById('evtReserveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Reservando…'; }
  try {
    const res = await tribuFetch(`/eventos/${evtActualId}/reservar`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo reservar');
    reservasIds.add(evtActualId);
    const ev = eventosCache.find(x => x.id === evtActualId);
    if (ev) actualizarModalReserva(ev);
    renderWeekList();
  } catch (err) {
    alert(err.message || 'No se pudo completar la reserva.');
    if (btn) { btn.disabled = false; btn.textContent = 'Reservar mi lugar'; }
  }
}

async function cancelarReservaActual() {
  if (!evtActualId) return;
  if (!confirm('¿Quieres cancelar tu reserva para este encuentro?')) return;
  try {
    const res = await tribuFetch(`/eventos/${evtActualId}/reservar`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo cancelar');
    }
    reservasIds.delete(evtActualId);
    const ev = eventosCache.find(x => x.id === evtActualId);
    if (ev) actualizarModalReserva(ev);
    renderWeekList();
  } catch (err) {
    alert(err.message || 'No se pudo cancelar la reserva.');
  }
}

async function descargarIcsActual() {
  if (!evtActualId) return;
  try {
    const res = await tribuFetch(`/eventos/${evtActualId}/ics`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo descargar');
    }
    const blob = await res.blob();
    const dispo = res.headers.get('Content-Disposition') || '';
    const m = dispo.match(/filename="([^"]+)"/);
    const name = m ? m[1] : 'la-tribu-evento.ics';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message || 'No se pudo añadir al calendario.');
  }
}

function cerrarEvento() {
  document.getElementById('evtOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarEvento(); });

function initWeekUi() {
  calWeekOffset = 0;
  weekStartYmd = mondayOnOrBefore(hoyLimaYmd());
  renderWeekLabel();
  renderTypeFilters();
  document.getElementById('evtReserveBtn')?.addEventListener('click', () => reservarEventoActual());
  document.getElementById('evtCancelBtn')?.addEventListener('click', () => cancelarReservaActual());
  document.getElementById('evtIcsBtn')?.addEventListener('click', () => descargarIcsActual());
  document.getElementById('calWeekPrev')?.addEventListener('click', () => cambiarSemana(-1));
  document.getElementById('calWeekNext')?.addEventListener('click', () => cambiarSemana(1));
  const toggle = document.getElementById('calToggleMonth');
  const panel = document.getElementById('calContenido');
  toggle?.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Ocultar calendario mensual' : 'Ver calendario mensual';
    if (open && !eventosMes.length) cargarMes();
  });
}

async function init() {
  const logueado = await verificarSesion();
  if (!logueado) {
    document.getElementById('calLockBanner').style.display = 'block';
    document.getElementById('calLockBanner').innerHTML = `<div class="lock-banner">
      <div class="lock-icon">🔒</div>
      <h3>Contenido exclusivo para miembros</h3>
      <p>Inicia sesión para ver el calendario de eventos.</p>
      <div class="lock-btns"><button type="button" class="lock-btn" onclick="window.location.href='${BASE}/camino?login=1'">Iniciar sesión</button></div>
    </div>`;
    const loading = document.getElementById('calLoading');
    if (loading) loading.style.display = 'none';
    return;
  }
  if (!tieneSuscripcion()) {
    document.getElementById('calLockBanner').style.display = 'block';
    document.getElementById('calLockBanner').innerHTML = `<div class="lock-banner">
      <div class="lock-icon">🔒</div>
      <h3>Necesitas una suscripción activa</h3>
      <p>Hola ${escapeHtml(window.tribuUser.nombre)}, activa tu suscripción para ver el calendario.</p>
      <div class="lock-btns"><button type="button" class="lock-btn" onclick="window.location.href='${BASE}/membresia'">Gestionar membresía</button></div>
    </div>`;
    const loading = document.getElementById('calLoading');
    if (loading) loading.style.display = 'none';
    return;
  }
  if (typeof TribuContenido !== 'undefined') {
    const c = await TribuContenido.load('member_calendario');
    if (c) {
      TribuContenido.setText(document.querySelector('.member-page-eyebrow'), c.eyebrow);
      TribuContenido.setText(document.querySelector('.member-page-hero h1'), c.titulo);
      TribuContenido.setText(document.querySelector('.member-page-lead'), c.lead);
      if (c.empty_week) window._calEmptyWeek = c.empty_week;
      const info = document.getElementById('calInfoLine');
      if (info && c.nota) {
        info.textContent = c.nota;
        info.hidden = false;
      }
    }
  }
  const infoEl = document.getElementById('calInfoLine');
  if (infoEl && infoEl.hidden && !infoEl.textContent.trim()) {
    infoEl.textContent = 'Las fechas y facilitadores pueden actualizarse. Revisa este calendario antes de cada encuentro.';
    infoEl.hidden = false;
  }
  initWeekUi();
  const now = hoyLimaYmd();
  const [y, mo] = now.split('-').map(Number);
  calYear = y;
  calMonth = mo - 1;
  await cargarReservas();
  await ensureWeekEventsLoaded();
}

window.initCalendarioMiembro = init;
window.cambiarMes = cambiarMes;
window.verEvento = verEvento;
window.cerrarEvento = cerrarEvento;
