(function () {
  let catalog = [];
  let slugActual = '';

  async function initPage() {
    if (!await AdminLayout.init({ page: 'contenido', title: 'Contenido' })) return;
    const res = await AdminApi.apiFetch('/contenido/admin/catalogo');
    if (!res.ok) return toast('No se pudo cargar el catálogo', 'error');
    const data = await res.json();
    catalog = data.slugs || [];
    renderSlugs();
    if (catalog.length) selectSlug(catalog[0].slug);

    document.getElementById('btn-contenido-guardar').addEventListener('click', guardar);
    document.getElementById('btn-contenido-formatear').addEventListener('click', formatear);
    document.getElementById('btn-contenido-restaurar').addEventListener('click', restaurar);
  }

  function renderSlugs() {
    const wrap = document.getElementById('contenido-slugs');
    const groups = {};
    catalog.forEach(s => {
      const g = s.grupo || 'Otro';
      if (!groups[g]) groups[g] = [];
      groups[g].push(s);
    });
    wrap.innerHTML = Object.keys(groups).map(g =>
      '<div style="margin-bottom:12px"><div style="font-size:.7rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">' +
      AdminApi.escapeHtml(g) + '</div>' +
      groups[g].map(s =>
        '<button type="button" class="btn btn-outline btn-sm" style="width:100%;justify-content:flex-start;margin-bottom:4px" data-slug="' +
        AdminApi.escapeHtml(s.slug) + '">' + AdminApi.escapeHtml(s.label) + '</button>'
      ).join('') + '</div>'
    ).join('');
    wrap.querySelectorAll('[data-slug]').forEach(btn => {
      btn.addEventListener('click', () => selectSlug(btn.getAttribute('data-slug')));
    });
  }

  async function selectSlug(slug) {
    slugActual = slug;
    document.querySelectorAll('#contenido-slugs [data-slug]').forEach(b => {
      b.classList.toggle('btn-primary', b.getAttribute('data-slug') === slug);
      b.classList.toggle('btn-outline', b.getAttribute('data-slug') !== slug);
    });
    const meta = catalog.find(c => c.slug === slug);
    document.getElementById('contenido-slug-title').textContent = meta ? meta.label : slug;
    let hint = 'Claves según la plantilla del código. Tras guardar, recarga la página pública para ver cambios.';
    if (slug === 'funnel_empezar') {
      hint += ' Los chips de objetivos e intereses se editan en Ajustes → Comunidad (catálogo tribu-catalogo).';
    }
    if (slug === 'funnel_checkout') {
      hint += ' Precio y días de prueba vienen de Ajustes → Suscripciones y GET /api/funnel (placeholders {trial_dias}, {precio}, {fecha_renovacion}).';
    }
    document.getElementById('contenido-slug-hint').textContent = hint;
    const res = await AdminApi.apiFetch('/contenido/admin/' + encodeURIComponent(slug));
    if (!res.ok) return toast('Error al cargar sección', 'error');
    const data = await res.json();
    document.getElementById('contenido-json').value = JSON.stringify(data.datos, null, 2);
  }

  function formatear() {
    const ta = document.getElementById('contenido-json');
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
      AdminUtils.mostrarMsg(document.getElementById('contenido-msg'), 'JSON formateado', true);
    } catch {
      AdminUtils.mostrarMsg(document.getElementById('contenido-msg'), 'JSON inválido', false);
    }
  }

  async function guardar() {
    if (!slugActual) return;
    let datos;
    try {
      datos = JSON.parse(document.getElementById('contenido-json').value);
    } catch {
      return AdminUtils.mostrarMsg(document.getElementById('contenido-msg'), 'JSON inválido', false);
    }
    const res = await AdminApi.apiFetch('/contenido/admin/' + encodeURIComponent(slugActual), {
      method: 'PUT',
      body: JSON.stringify({ datos }),
    });
    AdminUtils.mostrarMsg(document.getElementById('contenido-msg'), res.ok ? 'Guardado' : 'Error al guardar', res.ok);
    if (res.ok) toast('Contenido actualizado', 'success');
  }

  async function restaurar() {
    if (!slugActual || !confirm('¿Restaurar textos por defecto de esta sección?')) return;
    const res = await AdminApi.apiFetch('/contenido/admin/' + encodeURIComponent(slugActual) + '/restaurar', {
      method: 'POST',
    });
    if (res.ok) {
      const data = await res.json();
      document.getElementById('contenido-json').value = JSON.stringify(data.datos, null, 2);
      toast('Restaurado', 'success');
    } else {
      toast('Error al restaurar', 'error');
    }
  }

  initPage();
})();
