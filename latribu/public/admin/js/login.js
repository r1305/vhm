(function () {
  AdminAuth.loadTheme();
  if (AdminAuth.state.token) {
    var destino = AdminLayout.firstAllowedHref();
    if (destino) location.href = destino;
    return;
  }

  var logo = document.getElementById('login-logo');
  if (logo) logo.src = AdminApi.asset('logo_vhm.jpeg');

  var userEl = document.getElementById('login-user');
  var passEl = document.getElementById('login-pass');
  var errEl = document.getElementById('login-error');
  var btn = document.getElementById('login-btn');
  var btnText = document.getElementById('login-btn-text');

  async function doLogin() {
    var u = userEl.value.trim();
    var p = passEl.value;
    if (!u || !p) {
      errEl.textContent = 'Ingresa usuario y contraseña';
      errEl.style.display = 'block';
      return;
    }
    btn.disabled = true;
    btnText.textContent = 'Ingresando...';
    errEl.style.display = 'none';
    try {
      await AdminAuth.login(u, p);
      var destino = AdminLayout.firstAllowedHref();
      if (destino) {
        location.href = destino;
      } else {
        // Entro bien pero no tiene ninguna seccion habilitada: no hay pagina a
        // la que enviarlo, asi que se lo decimos en vez de deixar la pagina en
        // blanco o redirigir en bucle.
        errEl.textContent = 'Tu cuenta no tiene ninguna seccion habilitada. Pide a un Super Admin que te asigne accesos.';
        errEl.style.display = 'block';
        AdminAuth.logout();
      }
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btnText.textContent = 'Ingresar';
    }
  }

  btn.addEventListener('click', doLogin);
  passEl.addEventListener('keypress', function (e) { if (e.key === 'Enter') doLogin(); });
  userEl.addEventListener('keypress', function (e) { if (e.key === 'Enter') doLogin(); });
})();
