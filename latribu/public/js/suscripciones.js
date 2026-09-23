/* suscripciones.js */

async function cargarMisSuscripciones() {
  const lista = document.getElementById('subsLista');
  const renewalPanel = document.getElementById('subsRenewalPanel');
  if (!lista) return;
  lista.innerHTML = '<div class="subs-empty">Cargando...</div>';
  try {
    const res = await tribuFetch('/tribu-auth/suscripciones');
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Error');
    const subs = d.data || [];
    const tarjetas = d.tarjetas || [];

    const activaAuto = subs.find(s => s.activo && s.auto_renovacion);
    const activaSinAuto = subs.find(s => s.activo && !s.auto_renovacion);

    if (renewalPanel) {
      if (activaAuto) {
        renewalPanel.style.display = 'block';
        renewalPanel.innerHTML =
          '<h3>Renovación automática activa</h3>' +
          '<p>Tu plan <strong>' + escapeHtml(activaAuto.nombre) + '</strong> se renovará el <strong>' + escapeHtml(activaAuto.proxima_renovacion || activaAuto.fecha_fin) + '</strong>.' +
          (activaAuto.tarjeta_label ? ' Cobro con ' + escapeHtml(activaAuto.tarjeta_label) + '.' : '') + '</p>' +
          '<div class="subs-renewal-meta">Puedes cancelar en cualquier momento; mantendrás acceso hasta la fecha de vencimiento.</div>';
      } else if (activaSinAuto) {
        renewalPanel.style.display = 'block';
        renewalPanel.innerHTML =
          '<h3>Sin renovación automática</h3>' +
          '<p>Tu plan vence el <strong>' + escapeHtml(activaSinAuto.fecha_fin) + '</strong>. ' +
          (tarjetas.length
            ? 'Gestiona tus tarjetas en <a href="' + BASE + '/tarjetas" class="subs-link-btn">Mis tarjetas</a>.'
            : 'Al renovar, activa la opción de cobro automático para guardar tu tarjeta.') +
          '</p>';
      } else {
        renewalPanel.style.display = 'none';
      }
    }

    if (!subs.length) {
      lista.innerHTML = '<div class="subs-card subs-empty">Aún no tienes suscripciones. <button type="button" class="profile-btn profile-btn-primary" style="margin-top:14px" onclick="abrirModalPlanes()">Ver planes</button></div>';
      return;
    }

    lista.innerHTML = subs.map(s => {
      const fin = formatYmd(s.fecha_fin);
      const ini = formatYmd(s.fecha_inicio);
      let badgeClass = 'off', badgeText = 'Vencida';
      if (s.activo && s.auto_renovacion) { badgeClass = 'on'; badgeText = 'Activa · autorenovación'; }
      else if (s.activo) { badgeClass = 'warn'; badgeText = 'Activa · sin autorenovación'; }
      let actions = '';
      if (s.activo && s.puede_cancelar_autorenovacion)
        actions += '<button type="button" class="subs-cancel-btn" onclick="cancelarAutorenovacion(' + s.id + ')">Cancelar autorenovación</button>';
      if (s.activo && s.puede_activar_autorenovacion)
        actions += '<button type="button" class="profile-btn profile-btn-outline" style="padding:8px 14px;font-size:.82rem" onclick="activarAutorenovacion(' + s.id + ')">Activar autorenovación</button>';
      if (!s.activo)
        actions += '<button type="button" class="profile-btn profile-btn-primary" style="padding:8px 14px;font-size:.82rem" onclick="abrirModalPlanes()">Renovar plan</button>';
      const renewLine = s.auto_renovacion && s.proxima_renovacion
        ? '<div class="subs-meta">Próximo cobro: ' + escapeHtml(s.proxima_renovacion) + (s.tarjeta_label ? ' · ' + escapeHtml(s.tarjeta_label) : '') + '</div>'
        : (s.tarjeta_label ? '<div class="subs-meta">Tarjeta: ' + escapeHtml(s.tarjeta_label) + '</div>' : '');
      return '<div class="subs-card' + (s.activo ? ' active' : '') + '">' +
        '<div class="subs-title">' + escapeHtml(s.nombre) + '</div>' +
        '<div class="subs-meta">S/ ' + parseFloat(s.precio).toFixed(2) + ' · ' + ini + ' → ' + fin + '</div>' +
        renewLine +
        (s.descripcion ? '<div class="subs-meta">' + escapeHtml(s.descripcion) + '</div>' : '') +
        '<span class="subs-badge ' + badgeClass + '">' + badgeText + '</span>' +
        (actions ? '<div class="subs-actions">' + actions + '</div>' : '') +
        '</div>';
    }).join('');
  } catch {
    lista.innerHTML = '<div class="subs-empty">No se pudieron cargar las suscripciones.</div>';
  }
}

async function cancelarAutorenovacion(subId) {
  const ok = await mostrarTribuConfirm({
    title: '¿Cancelar autorenovación?',
    message: 'Seguirás con acceso hasta la fecha de vencimiento. Después tendrás que renovar manualmente.',
    confirmText: 'Sí, cancelar', cancelText: 'No, mantener',
  });
  if (!ok) return;
  try {
    const res = await tribuFetch('/tribu-auth/suscripciones/' + subId + '/auto-renovacion', {
      method: 'PUT', body: { enabled: false },
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Error');
    await cargarMisSuscripciones();
    mostrarTribuFeedback({ type: 'success', title: 'Autorenovación cancelada', message: d.message || 'Tu acceso sigue activo hasta la fecha de vencimiento.', btnText: 'Entendido' });
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
    await cargarMisSuscripciones();
    mostrarTribuFeedback({ type: 'success', title: 'Autorenovación activada', message: d.message || 'Autorenovación activada.', btnText: 'Entendido' });
  } catch (err) {
    mostrarTribuFeedback({ type: 'error', title: 'No se pudo activar', message: err.message || 'Intenta de nuevo.', btnText: 'Cerrar' });
  }
}

/* planes stub — se puede expandir igual que en index.html */
let planesCache = null;

async function abrirModalPlanes() {
  document.getElementById('planesError').textContent = '';
  document.getElementById('planesLista').innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px">Cargando planes...</div>';
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
        (p.descripcion ? '<div class="plan-desc">' + escapeHtml(p.descripcion) + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
        '<div class="plan-precio">S/ ' + parseFloat(p.precio).toFixed(2) + '<span style="font-size:.75rem;font-weight:700;color:var(--muted);margin-left:4px">/ mes</span></div>' +
        '<button class="plan-adquirir" onclick="window.location.href=\'' + BASE + '/?plan=' + p.id + '\'">Adquirir</button>' +
      '</div>' +
    '</div>'
  ).join('');
}

function cerrarModalPlanes() {
  document.getElementById('planesOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

/* ── Init ── */
(async () => {
  if (!requireAuth()) return;
  const ok = await verificarSesion();
  if (!ok) { window.location.href = BASE + '/?login=1'; return; }
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
})();
