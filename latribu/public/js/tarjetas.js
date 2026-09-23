/* tarjetas.js */

function formatTarjetaExp(t) {
  if (!t?.exp_month || !t?.exp_year) return '';
  return String(t.exp_month).padStart(2, '0') + '/' + String(t.exp_year).slice(-2);
}

function renderTarjetasHtml(tarjetas) {
  if (!tarjetas.length) {
    return '<div class="cards-empty">' +
      '<div class="cards-empty-icon">💳</div>' +
      '<p>Aún no tienes tarjetas guardadas.</p>' +
      '<p class="cards-empty-hint">Al pagar un plan con renovación automática, tu tarjeta aparecerá aquí.</p>' +
      '<a href="' + BASE + '/suscripciones" class="profile-btn profile-btn-primary" style="display:inline-block;text-decoration:none">Ver suscripciones</a>' +
    '</div>';
  }
  return '<div class="cards-list">' + tarjetas.map(t => {
    const exp = formatTarjetaExp(t);
    return '<div class="cards-item' + (t.is_default ? ' is-default' : '') + '">' +
      '<div class="cards-item-main">' +
        '<div class="cards-item-icon">💳</div>' +
        '<div>' +
          '<div class="cards-item-label">' + escapeHtml(t.label) + '</div>' +
          (exp ? '<div class="cards-item-meta">Vence ' + escapeHtml(exp) + '</div>' : '') +
          (t.is_default ? '<span class="cards-default-badge">Principal</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="cards-item-actions">' +
        (!t.is_default ? '<button type="button" class="subs-link-btn" onclick="marcarTarjetaDefault(' + t.id + ')">Hacer principal</button>' : '') +
        '<button type="button" class="subs-link-btn danger" onclick="eliminarTarjetaGuardada(' + t.id + ')">Eliminar</button>' +
      '</div>' +
    '</div>';
  }).join('') + '</div>' +
  '<p class="cards-footnote">Las tarjetas se almacenan en Culqi (PCI DSS). Eliminar una tarjeta desactiva la autorenovación vinculada.</p>';
}

async function cargarMisTarjetas() {
  const lista = document.getElementById('cardsLista');
  if (!lista) return;
  lista.innerHTML = '<div class="subs-empty">Cargando...</div>';
  try {
    const res = await tribuFetch('/tribu-auth/tarjetas');
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Error');
    lista.innerHTML = renderTarjetasHtml(d.data || []);
  } catch {
    lista.innerHTML = '<div class="cards-empty">No se pudieron cargar tus tarjetas.</div>';
  }
}

async function eliminarTarjetaGuardada(cardId) {
  const ok = await mostrarTribuConfirm({
    title: '¿Eliminar esta tarjeta?',
    message: 'Se desactivará la autorenovación vinculada. Tu acceso actual no se ve afectado hasta la fecha de vencimiento.',
    confirmText: 'Sí, eliminar', cancelText: 'Cancelar',
  });
  if (!ok) return;
  try {
    const res = await tribuFetch('/tribu-auth/tarjetas/' + cardId, { method: 'DELETE' });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Error');
    await cargarMisTarjetas();
    mostrarTribuFeedback({ type: 'success', title: 'Tarjeta eliminada', message: d.message || 'La tarjeta fue eliminada correctamente.', btnText: 'Entendido' });
  } catch (err) {
    mostrarTribuFeedback({ type: 'error', title: 'No se pudo eliminar', message: err.message || 'Intenta de nuevo.', btnText: 'Cerrar' });
  }
}

async function marcarTarjetaDefault(cardId) {
  try {
    const res = await tribuFetch('/tribu-auth/tarjetas/' + cardId + '/default', { method: 'PUT' });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Error');
    await cargarMisTarjetas();
    mostrarTribuFeedback({ type: 'success', title: 'Tarjeta principal', message: d.message || 'Tarjeta principal actualizada.', btnText: 'Entendido' });
  } catch (err) {
    mostrarTribuFeedback({ type: 'error', title: 'No se pudo actualizar', message: err.message || 'Intenta de nuevo.', btnText: 'Cerrar' });
  }
}

/* ── Init ── */
(async () => {
  if (!requireAuth()) return;
  const ok = await verificarSesion();
  if (!ok) { window.location.href = BASE + '/?login=1'; return; }
  await cargarMisTarjetas();

  document.getElementById('tribuConfirmCancel')?.addEventListener('click', () => cerrarTribuConfirm(false));
  document.getElementById('tribuConfirmOk')?.addEventListener('click', () => cerrarTribuConfirm(true));
  document.getElementById('tribuConfirmOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'tribuConfirmOverlay') cerrarTribuConfirm(false);
  });
  document.getElementById('tribuFeedbackOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'tribuFeedbackOverlay' && !e.currentTarget.classList.contains('no-dismiss')) cerrarTribuFeedback();
  });
})();
