(function () {
  AdminAuth.loadTheme();
  if (AdminAuth.state.token) {
    location.href = 'reclamos.html';
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
      location.href = 'reclamos.html';
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
