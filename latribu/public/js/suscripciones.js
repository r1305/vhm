/* Mi membresía — pantalla funnel #membership */

function formatDateLima(ymd) {
  if (!ymd) return '';
  return new Date(String(ymd).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-PE', {
    timeZone: 'America/Lima',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatMoney(precio) {
  const n = Number(precio);
  if (typeof TribuFunnel !== 'undefined' && TribuFunnel.formatMoneySimple) {
    return TribuFunnel.formatMoneySimple(Number.isFinite(n) ? n : 0);
  }
  return 'S/ ' + (Number.isFinite(n) ? n.toFixed(2) : '0.00');
}

function pickActiveSub(subs) {
  return (subs || []).find(s => s.activo) || null;
}

function membershipTag(sub) {
  if (!sub) return '';
  if (sub.es_prueba && sub.auto_renovacion) return 'Prueba gratuita';
  if (sub.es_prueba && !sub.auto_renovacion) return 'Renovación cancelada';
  if (sub.auto_renovacion) return 'Membresía activa';
  return 'Renovación cancelada';
}

function membershipInfoLine(sub, precioFmt, finLabel) {
  if (!sub) return '';
  const fin = finLabel || formatDateLima(sub.fecha_fin);
  if (!sub.auto_renovacion) {
    return 'No habrá cobro al terminar tu periodo actual. Puedes utilizar todos los recursos hasta el ' + fin + '.';
  }
  if (sub.es_prueba) {
    return 'Te avisaremos antes de terminar tu prueba. Si no cancelas, el ' + fin + ' se cobrará ' + precioFmt + ' y luego cada mes.';
  }
  return 'Tu membresía se renueva automáticamente el ' + fin + ' por ' + precioFmt + ' mensuales, salvo que canceles antes.';
}

function renderNoMembership(card, funnel) {
  const plan = funnel?.plan;
  const nombre = escapeHtml(plan?.nombre || 'Todo La Tribu');
  const precio = plan?.precio != null ? Number(plan.precio) : Number(funnel?.precio_mensual || 0);
  const dias = funnel?.trial_dias || 7;
  const precioFmt = formatMoney(precio);
  card.innerHTML =
    '<div class="member-membership-empty">' +
    '<span class="member-membership-tag">Sin membresía activa</span>' +
    '<h3 class="member-membership-plan">' + nombre + '</h3>' +
    '<div class="member-membership-price">' + precioFmt + ' <span>/ mes</span></div>' +
    '<p class="member-membership-micro" style="margin-top:14px;text-align:left;">' +
    'Prueba gratuita de ' + dias + ' días con acceso completo. Hoy pagas S/0; si no cancelas, se renueva al finalizar la prueba.' +
    '</p>' +
    '<a class="member-membership-btn-primary" href="' + BASE + '/checkout">Empezar prueba gratuita</a>' +
    '</div>';
}

function renderMembershipCard(sub, funnel) {
  const card = document.getElementById('memberMembershipCard');
  if (!card) return;

  if (!sub) {
    renderNoMembership(card, funnel);
    return;
  }

  const precio = Number(sub.precio);
  const precioFmt = formatMoney(precio);
  const finLabel = formatDateLima(sub.fecha_fin);
  const tag = membershipTag(sub);
  const tagClass = sub.auto_renovacion ? '' : ' cancelled';
  const primerCobro = !sub.auto_renovacion
    ? 'Cancelado'
    : (sub.es_prueba ? finLabel : formatDateLima(sub.proxima_renovacion || sub.fecha_fin));
  const importeHoy = sub.es_prueba ? 'S/0' : '—';
  const finPrueba = sub.es_prueba ? finLabel : '—';
  const renovacion = sub.auto_renovacion ? 'Automática · mensual' : 'Desactivada';

  let actions = '';
  if (sub.puede_cancelar_autorenovacion) {
    actions += '<button type="button" class="member-membership-btn-secondary" id="btnCancelRenewal">Cancelar renovación</button>';
  }
  if (sub.puede_activar_autorenovacion) {
    actions += '<button type="button" class="member-membership-btn-primary" id="btnResumeRenewal">Reactivar renovación</button>';
  }
  if (actions) {
    actions = '<div class="member-membership-card-actions">' + actions + '</div>';
  }

  card.innerHTML =
    '<span class="member-membership-tag' + tagClass + '">' + escapeHtml(tag) + '</span>' +
    '<h3 class="member-membership-plan">' + escapeHtml(sub.nombre || 'Todo La Tribu') + '</h3>' +
    '<div class="member-membership-price">' + precioFmt + ' <span>/ mes</span></div>' +
    '<dl class="member-membership-dl">' +
    '<dt>Importe de hoy</dt><dd>' + escapeHtml(importeHoy) + '</dd>' +
    '<dt>Fin de prueba</dt><dd>' + escapeHtml(finPrueba) + '</dd>' +
    '<dt>Primer cobro</dt><dd>' + escapeHtml(primerCobro) + '</dd>' +
    '<dt>Renovación</dt><dd>' + escapeHtml(renovacion) + '</dd>' +
    '<dt>Acceso</dt><dd>Completo hasta ' + escapeHtml(finLabel) + '</dd>' +
    '</dl>' +
    '<div class="member-membership-info">' + escapeHtml(membershipInfoLine(sub, precioFmt, finLabel)) + '</div>' +
    actions +
    '<p class="member-membership-micro">Los cobros se procesan de forma segura. Puedes revisar o cambiar tu tarjeta en <a href="' + BASE + '/tarjetas">Mis tarjetas</a>.</p>';
}

async function fetchFunnelConfig() {
  try {
    const res = await fetch(API + '/funnel');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function cargarMisSuscripciones() {
  const card = document.getElementById('memberMembershipCard');
  if (!card) return;
  window._tribuLoaderStart?.();
  try {
    const [res, funnel] = await Promise.all([
      tribuFetch('/tribu-auth/suscripciones'),
      fetchFunnelConfig(),
    ]);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Error');
    const subs = d.data || [];
    window._membershipSubs = subs;
    const active = pickActiveSub(subs);
    renderMembershipCard(active, funnel);

    document.getElementById('btnCancelRenewal')?.addEventListener('click', () => {
      if (active) cancelarAutorenovacion(active.id);
    });
    document.getElementById('btnResumeRenewal')?.addEventListener('click', () => {
      if (active) activarAutorenovacion(active.id);
    });
  } catch {
    card.innerHTML =
      '<p class="member-membership-micro" style="text-align:center;color:#be123c;">No se pudo cargar tu membresía. Intenta de nuevo en unos minutos.</p>' +
      '<button type="button" class="member-membership-btn-primary" onclick="cargarMisSuscripciones()">Reintentar</button>';
  } finally {
    window._tribuLoaderEnd?.();
  }
}

async function cancelarAutorenovacion(subId) {
  const ok = await mostrarTribuConfirm({
    title: '¿Cancelar renovación?',
    message: 'Seguirás con acceso hasta la fecha de vencimiento. Después tendrás que renovar manualmente si quieres continuar.',
    confirmText: 'Sí, cancelar', cancelText: 'No, mantener',
  });
  if (!ok) return;
  try {
    const res = await tribuFetch('/tribu-auth/suscripciones/' + subId + '/auto-renovacion', {
      method: 'PUT', body: { enabled: false },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Error');
    await verificarSesion();
    await cargarMisSuscripciones();
    mostrarTribuFeedback({
      type: 'success',
      title: 'Renovación cancelada',
      message: d.message || 'Tu acceso sigue activo hasta la fecha de vencimiento.',
      btnText: 'Entendido',
    });
  } catch (err) {
    mostrarTribuFeedback({ type: 'error', title: 'No se pudo cancelar', message: err.message || 'Intenta de nuevo.', btnText: 'Cerrar' });
  }
}

async function activarAutorenovacion(subId) {
  try {
    const res = await tribuFetch('/tribu-auth/suscripciones/' + subId + '/auto-renovacion', {
      method: 'PUT', body: { enabled: true },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Error');
    await verificarSesion();
    await cargarMisSuscripciones();
    mostrarTribuFeedback({
      type: 'success',
      title: 'Renovación activada',
      message: d.message || 'La renovación automática quedó activa.',
      btnText: 'Entendido',
    });
  } catch (err) {
    mostrarTribuFeedback({ type: 'error', title: 'No se pudo activar', message: err.message || 'Intenta de nuevo.', btnText: 'Cerrar' });
  }
}

let planesCache = null;

async function abrirModalPlanes() {
  document.getElementById('planesError').textContent = '';
  document.getElementById('planesLista').innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px">Cargando planes…</div>';
  document.getElementById('planesOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
  if (!planesCache) {
    try {
      const res = await fetch(API + '/suscripciones/public');
      const d = await res.json();
      if (!d.activo || !d.data.length) {
        document.getElementById('planesLista').innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px">No hay planes disponibles.</div>';
        return;
      }
      planesCache = d.data;
    } catch {
      document.getElementById('planesError').textContent = 'Error al cargar los planes.';
      document.getElementById('planesLista').innerHTML = '';
      return;
    }
  }
  document.getElementById('planesLista').innerHTML = planesCache.map(p =>
    '<div class="plan-card">' +
      '<div class="plan-info">' +
        '<div class="plan-nombre">' + escapeHtml(p.nombre) + '</div>' +
        (p.descripcion ? '<div class="plan-desc">' + p.descripcion + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
        '<div class="plan-precio">S/ ' + parseFloat(p.precio).toFixed(2) + '<span style="font-size:.75rem;font-weight:700;color:var(--muted);margin-left:4px">/ mes</span></div>' +
        '<button class="plan-adquirir" onclick="window.location.href=\'' + BASE + '/checkout\'">Empezar prueba</button>' +
      '</div>' +
    '</div>'
  ).join('');
}

function cerrarModalPlanes() {
  document.getElementById('planesOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

function initMembershipHelp() {
  document.getElementById('membershipHelpBtn')?.addEventListener('click', () => {
    mostrarTribuFeedback({
      type: 'success',
      title: 'Estamos para ayudarte',
      message: 'Si tienes dudas sobre tu prueba, un cobro o tu acceso, escríbenos desde la web de VHM Bienestar o contacta al equipo que te dio acceso a La Tribu.',
      btnText: 'Entendido',
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  const shellOk = await MemberApp.init({ layout: 'funnel', requireSub: false, skipOnboarding: true });
  if (!shellOk) return;

  const ok = await verificarSesion();
  if (!ok) { window.location.href = BASE + '/camino?login=1'; return; }
  initMembershipHelp();
  await cargarMisSuscripciones();

  document.getElementById('planesOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'planesOverlay') cerrarModalPlanes();
  });
  document.getElementById('tribuConfirmCancel')?.addEventListener('click', () => cerrarTribuConfirm(false));
  document.getElementById('tribuConfirmOk')?.addEventListener('click', () => cerrarTribuConfirm(true));
  document.getElementById('tribuConfirmOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'tribuConfirmOverlay') cerrarTribuConfirm(false);
  });
  document.getElementById('tribuFeedbackOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'tribuFeedbackOverlay' && !e.currentTarget.classList.contains('no-dismiss')) cerrarTribuFeedback();
  });
});
