/* calendario.js */

const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DOW_ES = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

let eventosMes = [];
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();

function fmtHora(t) { return t ? String(t).slice(0, 5) : ''; }

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

  const today = new Date();
  const hoyStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  let html = '';
  for (let i = 0; i < startDow; i++) html += '<div class="cal-day other"></div>';
  for (let d = 1; d <= lastDay; d++) {
    const fechaStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const evs = eventosMes.filter(e => String(e.fecha).slice(0,10) === fechaStr);
    const isToday = fechaStr === hoyStr;
    html += `<div class="cal-day${isToday ? ' today' : ''}">
      <div class="cal-day-num">${d}</div>
      <div class="cal-events-desktop">${evs.map(e => `<div class="cal-ev" onclick="verEvento(${e.id})">${escapeHtml(e.nombre)}</div>`).join('')}</div>
      <div class="cal-events-mobile">${evs.length ? `<div class="cal-icon" onclick="verEvento(${evs[0].id})"><span class="cal-icon-inner">📅</span>${evs.length > 1 ? `<span class="cal-badge">${evs.length}</span>` : ''}</div>` : ''}</div>
    </div>`;
  }
  grid.innerHTML = html;
}

async function cargarMes() {
  const loading = document.getElementById('calLoading');
  loading.style.display = 'block';
  loading.textContent = 'Cargando eventos...';
  const mes = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
  window._tribuLoaderStart();
  try {
    const res = await fetch(`${API}/eventos?mes=${mes}`);
    if (!res.ok) throw new Error();
    eventosMes = await res.json();
    if (!Array.isArray(eventosMes)) eventosMes = [];
    renderCalendario();
    loading.style.display = 'none';
  } catch {
    loading.textContent = 'No se pudieron cargar los eventos.';
  } finally {
    window._tribuLoaderEnd();
  }
}

function cambiarMes(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  cargarMes();
}

function verEvento(id) {
  const ev = eventosMes.find(x => x.id === id);
  if (!ev) return;
  const fin = ev.hora_fin ? ` – ${fmtHora(ev.hora_fin)}` : '';
  document.getElementById('evtNombre').textContent = ev.nombre;
  document.getElementById('evtFecha').textContent = String(ev.fecha).slice(0,10);
  document.getElementById('evtHora').textContent = `${fmtHora(ev.hora_inicio)}${fin}`;
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
  document.getElementById('evtOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function cerrarEvento() {
  document.getElementById('evtOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarEvento(); });

async function init() {
  const logueado = await verificarSesion();
  if (!logueado) {
    document.getElementById('calLockBanner').style.display = 'block';
    document.getElementById('calLockBanner').innerHTML = `<div class="lock-banner">
      <div class="lock-icon">🔒</div>
      <h3>Contenido exclusivo para miembros</h3>
      <p>Inicia sesión para ver el calendario de eventos.</p>
      <div class="lock-btns"><button class="lock-btn lock-btn-primary" onclick="window.location.href='${BASE}/?login=1'">Iniciar sesión</button></div>
    </div>`;
    document.getElementById('calLoading').style.display = 'none';
    return;
  }
  if (!tieneSuscripcion()) {
    document.getElementById('calLockBanner').style.display = 'block';
    document.getElementById('calLockBanner').innerHTML = `<div class="lock-banner">
      <div class="lock-icon">🔒</div>
      <h3>Necesitas una suscripción activa</h3>
      <p>Hola ${escapeHtml(window.tribuUser.nombre)}, activa tu suscripción para ver el calendario.</p>
      <div class="lock-btns"><button class="lock-btn lock-btn-primary" onclick="window.location.href='${BASE}/suscripciones'">Ver planes</button></div>
    </div>`;
    document.getElementById('calLoading').style.display = 'none';
    return;
  }
  cargarMes();
}

init();
