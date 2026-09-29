(async function () {
  if (!await AdminLayout.init({ page: 'config', title: 'Ajustes' })) return;
  AdminUtils.bindTabs('.sub-tabs', '');
  AdminUtils.bindModalClose();

  // ── Quill para descripción de plan ──
  const EMOJIS = [
    // Caritas
    '😀','😁','😂','😃','😄','😅','😆','😇','😈','😉','😊','😋','😌','😍','😎','😏',
    '😐','😑','😒','😓','😔','😕','😖','😗','😘','😙','😚','😛','😜','😝','😞','😟',
    '😠','😡','😢','😣','😤','😥','😦','😧','😨','😩','😪','😫','😬','😭','😮','😯',
    '😰','😱','😲','😳','😴','😵','😶','😷','🥰','🥱','🥲','🥳','🥴','🥵','🥶','🥷',
    '🥸','🥹','🥺','🥻','🥼','🥽','🥾','🥿','🦀','🤔','🤨','🤩','🤪','🤫','🤬','🤭',
    '🤮','🤯','🤐','🤑','🤒','🤓','🤕','🤖','🤗','🤘','🤙','🤚','🤛','🤜','🤝','🤞',
    '🤟','🙈','🙉','🙊','🙋','🙌','🙍','🙎','🙏',
    // Manos y gestos
    '👋','🤚','👌','✌️','🤞','🤟','🤘','👈','👉','👆','👇','☝️','👍','👎',
    '✊','👊','🤛','🤜','👏','🙌','🙏','✍️','💅','💪','🦵','🦶','🤳','💏','💑',
    // Corazones y amor
    '❤️','🧡','💛','💚','💙','💜','💗','💘','💖','💕','💔','💓','💞','💝','💟','♥️',
    '❣️','💌','💋','💍','💎','💊','💉','🩸','🩹','🩺','🩻','🩼','🩽',
    // Celebración y logros
    '🎉','🎊','🎈','🎋','🎌','🎍','🎎','🎏','🎐','🎑','🎒','🎓','🏆','🥇','🥈','🥉',
    '🏅','🎖️','🎗️','🎫','🎪','🎭','🎨','🎧','🎤','🎥','🎦','🎩','🎬',
    // Naturaleza y animales
    '🐶','🐱','🐭','🐹','🐰','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐢','🐥',
    '🐦','🐧','🐤','🐣','🐝','🦋','🦌','🦍','🦎','🦏','🦐','🦑','🌸','🌹','🌺','🌻',
    '🌼','🌽','🌾','🌿','🍀','🍁','🍂','🍃','🍄','🍅','🍆','🍇','🍈','🍉','🍊','🍋',
    // Comida
    '🍌','🍍','🍎','🍏','🍐','🍑','🍒','🍓','🍔','🍕','🍖','🍗','🍘','🍙','🍚','🍛',
    '🍜','🍝','🍞','🍟','🍠','🍡','🍢','🍣','🍤','🍥','🍦','🍧','🍨','🍩','🍪','🍫',
    '🍬','🍭','🍮','🍯','🍰','🍱','🍲','🍳','🍴','🍵','🍶','🍷','🍸','🍹','🍺','🍻',
    // Viajes y lugares
    '✈️','🚀','🚁','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚋','🚌','🚍','🚎',
    '🌍','🌎','🌏','🌐','🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','🌙','🌚','🌛','🌜',
    '🌝','🌞','🌟','🌠','⭐','🌡️','⛅','☁️','⚡','🌈','❄️','☃️','🔥','💧','🌊',
    // Objetos y símbolos
    '💪','📚','📝','📧','📱','💻','💼','💰','💳','💴','💵','💶','💷','💸','💹','💺',
    '🔑','🔒','🔓','🔔','🔕','🔖','🔗','🔘','🔙','🔚','🔛','🔜','🔝','🔞','🔟','🔠',
    '✅','❌','✔️','✖️','➕','➖','➗','✴️','✳️','✨','💥','💦','💧','💨','💩','💯',
    '🎯','🎱','🎲','🎳','🎴','🎵','🎶','🎷','🎸','🎹','🎺','🎻','🎼','🎽','🎾','🎿',
    // Actividades y deporte
    '⚽','🏀','🏈','⚾','🎾','🎱','🏓','🏸','🏊','🏋️','🥊','🥋','🥌','🥍','🥎','🥏',
    '🧘','🧙','🧚','🧛','🧜','🧝','🧞','🧟','🧠','🧡','🧢','🧣','🧤','🧥','🧦','🧧',
    // Flechas y señales
    '➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','🔄','🔃','🔂','🔁','🔀','▶️','⏸️','⏹️',
    '⏺️','⏭️','⏮️','⏯️','⏱️','⏲️','⏰','⌚','⌛','▪️','▫️','◼️','◽','◾','◻',
  ];
  let quillDesc = null;

  function initQuillDesc() {
    if (quillDesc) return;
    quillDesc = new Quill('#pf-descripcion-editor', {
      theme: 'snow',
      placeholder: 'Acceso completo...',
      modules: { toolbar: [['bold','italic','underline'],[{'list':'ordered'},{'list':'bullet'}],['link'],['clean']] },
    });
    // Emoji grid
    const grid = document.getElementById('pf-desc-emoji-grid');
    grid.innerHTML = EMOJIS.map(e => `<button type="button" style="background:none;border:none;font-size:1.3rem;cursor:pointer;padding:4px;border-radius:6px" onclick="insertDescEmoji('${e}')">${e}</button>`).join('');
    document.getElementById('pf-desc-emoji-btn').addEventListener('click', e => {
      e.stopPropagation();
      const open = grid.style.display === 'flex';
      grid.style.display = open ? 'none' : 'flex';
    });
    document.addEventListener('click', () => { grid.style.display = 'none'; }, { capture: false });
  }

  window.insertDescEmoji = function(emoji) {
    if (!quillDesc) return;
    const range = quillDesc.getSelection(true);
    quillDesc.insertText(range.index, emoji);
    quillDesc.setSelection(range.index + emoji.length);
    document.getElementById('pf-desc-emoji-grid').style.display = 'none';
  };


  async function loadSusConfig() {
    const r = await AdminApi.apiFetch('/suscripciones/config');
    if (!r.ok) return;
    const d = await r.json();
    document.getElementById('sus-activo').checked = !!d.activo;
    document.getElementById('sus-visible').checked = !!d.visible;
  }

  async function loadPlanes() {
    const r = await AdminApi.apiFetch('/suscripciones');
    if (!r.ok) return;
    planes = await r.json();
    const tbody = document.getElementById('sus-tbody');
    if (!planes.length) { tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Sin planes</td></tr>'; return; }
    tbody.innerHTML = planes.map(p => `
      <tr>
        <td>${AdminApi.escapeHtml(p.nombre)}</td>
        <td>S/ ${Number(p.precio).toFixed(2)}</td>
        <td>${p.vigencia_dias} días</td>
        <td>${p.descripcion ? '<span title="' + AdminApi.escapeHtml(p.descripcion.replace(/<[^>]*>/g,'').slice(0,120)) + '">✓</span>' : '—'}</td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="editPlan(${p.id})">✏️</button>
          <button class="btn btn-danger btn-xs" onclick="deletePlan(${p.id})">🗑️</button>
        </td>
      </tr>`).join('');
  }

  document.getElementById('btn-sus-cfg-guardar').addEventListener('click', async () => {
    const r = await AdminApi.apiFetch('/suscripciones/config', {
      method: 'PUT',
      body: JSON.stringify({
        activo: document.getElementById('sus-activo').checked,
        visible: document.getElementById('sus-visible').checked,
      }),
    });
    toast(r.ok ? 'Configuración guardada' : 'Error al guardar', r.ok ? 'success' : 'error');
  });

  document.getElementById('btn-nuevo-plan').addEventListener('click', () => {
    editPlanId = null;
    document.getElementById('modal-plan-title').textContent = '💳 Nuevo Plan';
    ['pf-nombre', 'pf-precio'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('pf-vigencia').value = '30';
    initQuillDesc();
    quillDesc.root.innerHTML = '';
    AdminUtils.showModal('modal-plan');
  });

  window.editPlan = function (id) {
    const p = planes.find(x => x.id === id);
    if (!p) return;
    editPlanId = id;
    document.getElementById('modal-plan-title').textContent = '✏️ Editar Plan';
    document.getElementById('pf-nombre').value = p.nombre;
    document.getElementById('pf-precio').value = p.precio;
    document.getElementById('pf-vigencia').value = p.vigencia_dias;
    initQuillDesc();
    quillDesc.root.innerHTML = p.descripcion || '';
    AdminUtils.showModal('modal-plan');
  };

  window.deletePlan = async function (id) {
    if (!confirm('¿Eliminar este plan?')) return;
    const r = await AdminApi.apiFetch('/suscripciones/' + id, { method: 'DELETE' });
    toast(r.ok ? 'Plan eliminado' : 'Error al eliminar', r.ok ? 'success' : 'error');
    if (r.ok) loadPlanes();
  };

  document.getElementById('btn-guardar-plan').addEventListener('click', async () => {
    const body = {
      nombre: document.getElementById('pf-nombre').value.trim(),
      precio: document.getElementById('pf-precio').value,
      vigencia_dias: document.getElementById('pf-vigencia').value,
      descripcion: quillDesc ? quillDesc.root.innerHTML.trim() : '',
    };
    if (!body.nombre || !body.precio) return toast('Nombre y precio son obligatorios', 'error');
    const url = editPlanId ? '/suscripciones/' + editPlanId : '/suscripciones';
    const method = editPlanId ? 'PUT' : 'POST';
    const r = await AdminApi.apiFetch(url, { method, body: JSON.stringify(body) });
    const d = await r.json();
    toast(r.ok ? 'Plan guardado' : (d.error || 'Error'), r.ok ? 'success' : 'error');
    if (r.ok) { AdminUtils.hideModal('modal-plan'); loadPlanes(); }
  });

  // ── Culqi ──
  async function loadCulqi() {
    const r = await AdminApi.apiFetch('/config-culqi');
    if (!r.ok) return;
    const d = await r.json();
    document.getElementById('culqi-activo').checked = !!d.activo;
    document.getElementById('culqi-modo').value = d.modo || 'sandbox';
    document.getElementById('culqi-pk').value = d.public_key || '';
    document.getElementById('culqi-sk').value = d.secret_key || '';
  }

  document.getElementById('btn-culqi-guardar').addEventListener('click', async () => {
    const body = {
      activo: document.getElementById('culqi-activo').checked,
      modo: document.getElementById('culqi-modo').value,
      public_key: document.getElementById('culqi-pk').value.trim(),
      secret_key: document.getElementById('culqi-sk').value.trim(),
    };
    const r = await AdminApi.apiFetch('/config-culqi', { method: 'PUT', body: JSON.stringify(body) });
    const d = await r.json();
    AdminUtils.mostrarMsg(document.getElementById('culqi-msg'), r.ok ? 'Guardado' : (d.error || 'Error'), r.ok);
  });

  // ── Config general (pixel, whatsapp, redes) ──
  async function loadConfig() {
    const r = await AdminApi.apiFetch('/config');
    if (!r.ok) return;
    const d = await r.json();
    document.getElementById('pixel-activo').checked = !!d.pixel_activo;
    document.getElementById('pixel-id').value = d.pixel_id || '';
    document.getElementById('wa-activo').checked = !!d.whatsapp_activo;
    document.getElementById('wa-numero').value = d.whatsapp_numero || '';
    document.getElementById('wa-mensaje').value = d.whatsapp_mensaje || '';
    document.getElementById('red-instagram').value = d.instagram || '';
    document.getElementById('red-facebook').value = d.facebook || '';
    document.getElementById('red-youtube').value = d.youtube || '';
    document.getElementById('red-tiktok').value = d.tiktok || '';
  }

  async function saveConfig(extra) {
    const body = {
      pixel_id: document.getElementById('pixel-id').value.trim(),
      pixel_activo: document.getElementById('pixel-activo').checked,
      whatsapp_numero: document.getElementById('wa-numero').value.trim(),
      whatsapp_mensaje: document.getElementById('wa-mensaje').value.trim(),
      whatsapp_activo: document.getElementById('wa-activo').checked,
      instagram: document.getElementById('red-instagram').value.trim(),
      facebook: document.getElementById('red-facebook').value.trim(),
      youtube: document.getElementById('red-youtube').value.trim(),
      tiktok: document.getElementById('red-tiktok').value.trim(),
      ...extra,
    };
    const r = await AdminApi.apiFetch('/config', { method: 'PUT', body: JSON.stringify(body) });
    return r.ok;
  }

  document.getElementById('btn-pixel-guardar').addEventListener('click', async () => {
    const ok = await saveConfig();
    AdminUtils.mostrarMsg(document.getElementById('pixel-msg'), ok ? 'Guardado' : 'Error al guardar', ok);
  });
  document.getElementById('btn-wa-guardar').addEventListener('click', async () => {
    const ok = await saveConfig();
    AdminUtils.mostrarMsg(document.getElementById('wa-msg'), ok ? 'Guardado' : 'Error al guardar', ok);
  });
  document.getElementById('btn-redes-guardar').addEventListener('click', async () => {
    const ok = await saveConfig();
    AdminUtils.mostrarMsg(document.getElementById('redes-msg'), ok ? 'Guardado' : 'Error al guardar', ok);
  });

  // ── Beneficios landing ──
  let beneficiosData = [];

  async function loadLandingHero() {
    const r = await AdminApi.apiFetch('/videos/landing');
    if (!r.ok) return;
    const d = await r.json();
    document.getElementById('landing-title').value = d.hero_title || '';
    document.getElementById('landing-subtitle').value = d.hero_subtitle || '';
  }

  document.getElementById('btn-landing-hero-guardar').addEventListener('click', async () => {
    const body = {
      intro: ' ', pacto: ' ', // requeridos por la ruta pero no se usan aquí
      hero_title: document.getElementById('landing-title').value.trim(),
      hero_subtitle: document.getElementById('landing-subtitle').value.trim(),
    };
    // Cargar intro/pacto actuales para no pisarlos
    try {
      const cur = await AdminApi.apiFetch('/videos/landing');
      if (cur.ok) {
        const d = await cur.json();
        body.intro = d.intro || ' ';
        body.pacto = d.pacto || ' ';
        if (d.hero_video_url) body.hero_video_url = d.hero_video_url;
      }
    } catch {}
    const r = await AdminApi.apiFetch('/videos/landing', { method: 'PUT', body: JSON.stringify(body) });
    AdminUtils.mostrarMsg(document.getElementById('landing-hero-msg'), r.ok ? 'Guardado' : 'Error al guardar', r.ok);
  });

  async function loadBeneficios() {
    const r = await AdminApi.apiFetch('/config');
    if (!r.ok) return;
    const d = await r.json();
    const raw = d.beneficios;
    beneficiosData = Array.isArray(raw) ? raw
      : (raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : []);
    renderBeneficios();
  }

  function renderBeneficios() {
    const lista = document.getElementById('beneficios-lista');
    if (!lista) return;
    if (!beneficiosData.length) {
      lista.innerHTML = '<p style="font-size:.82rem;color:var(--text-muted)">Sin ítems. Agrega el primero.</p>';
      return;
    }
    lista.innerHTML = beneficiosData.map((item, i) =>
      `<div style="display:flex;gap:8px;align-items:center">
        <input type="text" value="${AdminApi.escapeHtml(item)}" data-idx="${i}"
          style="flex:1;padding:9px 12px;border:2px solid var(--border-strong);border-radius:10px;font-size:.9rem;background:var(--bg-input);color:var(--text-primary)"
          oninput="beneficiosData[this.dataset.idx]=this.value">
        <button type="button" class="btn btn-danger btn-xs" onclick="beneficiosEliminar(${i})">✕</button>
      </div>`
    ).join('');
  }

  window.beneficiosEliminar = function(i) {
    beneficiosData.splice(i, 1);
    renderBeneficios();
  };

  document.getElementById('btn-add-beneficio').addEventListener('click', () => {
    beneficiosData.push('');
    renderBeneficios();
    // focus en el nuevo input
    const inputs = document.querySelectorAll('#beneficios-lista input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  document.getElementById('btn-beneficios-guardar').addEventListener('click', async () => {
    // Leer valores actuales de los inputs
    document.querySelectorAll('#beneficios-lista input[data-idx]').forEach(inp => {
      beneficiosData[parseInt(inp.dataset.idx)] = inp.value.trim();
    });
    const items = beneficiosData.filter(Boolean);
    const ok = await saveConfig({ beneficios: items });
    if (ok) beneficiosData = items;
    AdminUtils.mostrarMsg(document.getElementById('beneficios-msg'), ok ? 'Guardado' : 'Error al guardar', ok);
  });

  // ── Chips de comunidad ──
  let chipsData = { intereses: [], objetivos: [] };
  let editChipId = null;
  let editChipTipo = null;

  async function loadChips(tipo) {
    const r = await AdminApi.apiFetch('/tribu-catalogo/admin/' + tipo);
    if (!r.ok) return;
    chipsData[tipo] = await r.json();
    renderChips(tipo);
  }

  function renderChips(tipo) {
    const lista = document.getElementById('chips-' + tipo + '-lista');
    if (!lista) return;
    if (!chipsData[tipo].length) {
      lista.innerHTML = '<p style="font-size:.82rem;color:var(--text-muted)">Sin chips. Agrega el primero.</p>';
      return;
    }
    lista.innerHTML = chipsData[tipo].map(c =>
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="flex:1;padding:7px 12px;border:1px solid var(--border-strong);border-radius:999px;font-size:.85rem;background:var(--bg-card);color:${c.activo ? 'var(--text-primary)' : 'var(--text-muted)'}">
          ${AdminApi.escapeHtml(c.label)}${!c.activo ? ' <em style="font-size:.72rem">(inactivo)</em>' : ''}
        </span>
        <button class="btn btn-outline btn-xs" onclick="editarChip(${c.id},'${tipo}')">&#9998;</button>
        <button class="btn btn-danger btn-xs" onclick="eliminarChip(${c.id},'${tipo}')">&#128465;</button>
      </div>`
    ).join('');
  }

  window.abrirChipModal = function(tipo) {
    editChipId = null;
    editChipTipo = tipo;
    document.getElementById('modal-chip-title').textContent = tipo === 'intereses' ? '🏷️ Nuevo interés' : '🏷️ Nuevo objetivo';
    document.getElementById('chip-id').value = '';
    document.getElementById('chip-tipo').value = tipo;
    document.getElementById('chip-label').value = '';
    document.getElementById('chip-orden').value = chipsData[tipo].length;
    document.getElementById('chip-activo').checked = true;
    AdminUtils.showModal('modal-chip');
    setTimeout(() => document.getElementById('chip-label').focus(), 80);
  };

  window.editarChip = function(id, tipo) {
    const c = chipsData[tipo].find(x => x.id === id);
    if (!c) return;
    editChipId = id;
    editChipTipo = tipo;
    document.getElementById('modal-chip-title').textContent = '✏️ Editar chip';
    document.getElementById('chip-id').value = id;
    document.getElementById('chip-tipo').value = tipo;
    document.getElementById('chip-label').value = c.label;
    document.getElementById('chip-orden').value = c.orden;
    document.getElementById('chip-activo').checked = !!c.activo;
    AdminUtils.showModal('modal-chip');
    setTimeout(() => document.getElementById('chip-label').focus(), 80);
  };

  window.eliminarChip = async function(id, tipo) {
    if (!confirm('¿Eliminar este chip?')) return;
    const r = await AdminApi.apiFetch('/tribu-catalogo/admin/' + id, { method: 'DELETE' });
    toast(r.ok ? 'Chip eliminado' : 'Error al eliminar', r.ok ? 'success' : 'error');
    if (r.ok) loadChips(tipo);
  };

  document.getElementById('btn-guardar-chip').addEventListener('click', async () => {
    const tipo = document.getElementById('chip-tipo').value;
    const label = document.getElementById('chip-label').value.trim();
    const orden = document.getElementById('chip-orden').value;
    const activo = document.getElementById('chip-activo').checked;
    if (!label) return toast('La etiqueta es obligatoria', 'error');
    const isEdit = !!editChipId;
    const url = isEdit ? '/tribu-catalogo/admin/' + editChipId : '/tribu-catalogo/admin';
    const method = isEdit ? 'PUT' : 'POST';
    const body = isEdit ? { label, orden, activo } : { tipo, label, orden, activo };
    const r = await AdminApi.apiFetch(url, { method, body: JSON.stringify(body) });
    const d = await r.json();
    toast(r.ok ? 'Guardado' : (d.error || 'Error'), r.ok ? 'success' : 'error');
    if (r.ok) { AdminUtils.hideModal('modal-chip'); loadChips(tipo); }
  });

  // Init
  loadSusConfig();
  loadPlanes();
  loadCulqi();
  loadConfig();
  loadLandingHero();
  loadBeneficios();
  loadChips('intereses');
  loadChips('objetivos');
})();
