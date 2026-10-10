(function () {
  const API = TribuFunnel.api();

  function $(id) { return document.getElementById(id); }

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname);
  }

  function bindShowPassword() {
    const show = $('pwShow');
    show.addEventListener('change', () => {
      const t = show.checked ? 'text' : 'password';
      $('pw1').type = t;
      $('pw2').type = t;
    });
  }

  function enlaceInvalido(msg) {
    $('rsForm').style.display = 'none';
    $('rsLead').textContent = msg || 'El enlace no es válido o ya venció. Vuelve a pedir uno desde «Olvidé mi contraseña».';
    $('rsOk').style.display = '';
    $('rsOkMsg').textContent = '';
  }

  async function onSubmit(e) {
    e.preventDefault();
    const err = $('pwErr');
    const btn = $('pwSave');
    const a = $('pw1').value;
    const b = $('pw2').value;
    err.textContent = '';
    if (a.length < 8) { err.textContent = 'La contraseña debe tener al menos 8 caracteres.'; return; }
    if (a !== b) { err.textContent = 'Las contraseñas no coinciden.'; return; }

    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const res = await fetch(API + '/tribu-auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: a }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 400 && /enlace/i.test(d.error || '')) { enlaceInvalido(d.error); return; }
        throw new Error(d.error || 'No se pudo guardar la contraseña');
      }
      $('rsForm').style.display = 'none';
      $('rsLead').style.display = 'none';
      $('rsOkMsg').textContent = d.message || 'Tu contraseña se actualizó.';
      $('rsOk').style.display = '';
    } catch (ex) {
      err.textContent = ex.message || 'No se pudo guardar la contraseña.';
      btn.disabled = false;
      btn.textContent = 'Guardar contraseña';
    }
  }

  if (!/^[a-f0-9]{64}$/.test(token)) {
    enlaceInvalido();
    return;
  }
  bindShowPassword();
  $('rsForm').addEventListener('submit', onSubmit);
})();
