(function () {
  const API = TribuFunnel.api();
  const BASE = TribuFunnel.base();
  const CULQI_TOKENS_URL = 'https://api.culqi.com/v2/tokens';

  let funnelCfg = { trial_dias: 7, precio_mensual: 39.9, plan: null };
  let culqiPublicCfg = null;
  let submitting = false;
  let copyCfg = null;

  function $(id) { return document.getElementById(id); }

  function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

  function formatCardInput(el) {
    const raw = digitsOnly(el.value).slice(0, 19);
    el.value = raw.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  }

  function formatExpInput(el) {
    let d = digitsOnly(el.value).slice(0, 4);
    if (d.length >= 3) d = d.slice(0, 2) + ' / ' + d.slice(2);
    el.value = d;
  }

  function parseExpiration(expRaw) {
    const d = digitsOnly(expRaw);
    if (d.length < 4) return null;
    const month = d.slice(0, 2);
    const yearPart = d.slice(2);
    const m = parseInt(month, 10);
    if (m < 1 || m > 12) return null;
    let year = yearPart.length === 2 ? 2000 + parseInt(yearPart, 10) : parseInt(yearPart, 10);
    if (yearPart.length === 2 && year < 2000) year += 100; // 30 -> 2030
    if (year < 2000 || year > 2099) return null;
    return {
      expiration_month: month.padStart(2, '0'),
      expiration_year: String(year),
    };
  }

  function culqiErrorMessage(data) {
    if (!data) return 'No se pudo validar la tarjeta';
    return data.user_message || data.merchant_message || data.message || 'No se pudo validar la tarjeta';
  }

  /** Token en el navegador con llave pública (PCI: no pasa por nuestro servidor). */
  async function createCulqiToken(publicKey, { card_number, cvv, expiration_month, expiration_year, email }) {
    const res = await fetch(CULQI_TOKENS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + publicKey,
      },
      body: JSON.stringify({
        card_number,
        cvv,
        expiration_month,
        expiration_year,
        email,
      }),
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(culqiErrorMessage(data));
    if (!data?.id) throw new Error('Culqi no devolvió un token válido');
    return data.id;
  }

  function formatRenewCaption(fechaRaw) {
    if (!fechaRaw) return 'Al terminar la prueba';
    const label = TribuFunnel.formatFunnelRenewalDate(fechaRaw, funnelCfg.trial_dias);
    return 'El ' + label;
  }

  function copyVars() {
    const d = funnelCfg.trial_dias || 7;
    const precio = TribuFunnel.formatMoneySimple(funnelCfg.precio_mensual);
    const renewYmd = funnelCfg.fecha_renovacion_ejemplo || '';
    const renewLabel = renewYmd
      ? TribuFunnel.formatFunnelRenewalDate(renewYmd, d)
      : 'al terminar tu prueba';
    return { trial_dias: d, precio, fecha_renovacion: renewLabel };
  }

  async function loadStaticCopy() {
    if (typeof TribuContenido === 'undefined') return;
    copyCfg = await TribuContenido.load('funnel_checkout');
    if (!copyCfg) return;
    TribuContenido.setText(document.querySelector('.co-login'), copyCfg.login_link);
    TribuContenido.setText(document.querySelector('.co-eyebrow'), copyCfg.eyebrow);
    TribuContenido.setText(document.querySelector('.co-intro h1'), copyCfg.titulo);
    TribuContenido.setText(document.querySelector('.co-unlock-title'), copyCfg.unlock_title);
    const pci = document.querySelector('.co-pci-note');
    if (pci && copyCfg.pci_note) pci.textContent = copyCfg.pci_note;
    const hint = $('coSandboxHint');
    if (hint && copyCfg.sandbox_hint) hint.textContent = copyCfg.sandbox_hint;
    const foot = document.querySelector('.co-form-foot');
    if (foot && copyCfg.form_foot) foot.innerHTML = copyCfg.form_foot.replace(/\n/g, '<br>');
    const list = document.querySelector('.co-offer-list');
    if (list && Array.isArray(copyCfg.unlock_list)) {
      list.innerHTML = copyCfg.unlock_list.map(t => `<li>${t.replace(/</g, '&lt;')}</li>`).join('');
    }
  }

  async function loadConfig() {
    try {
      const [fRes, cRes] = await Promise.all([
        fetch(API + '/funnel'),
        fetch(API + '/config-culqi/public'),
      ]);
      if (fRes.ok) funnelCfg = await fRes.json();
      if (cRes.ok) culqiPublicCfg = await cRes.json();
    } catch (_) {}
    await loadStaticCopy();
    TribuFunnel.captureUtm();
    const vars = copyVars();
    const d = vars.trial_dias;
    $('trialDaysLabel').textContent = d;
    $('trialDaysLabel2').textContent = d;
    const renewYmd = funnelCfg.fecha_renovacion_ejemplo || '';
    const caption = $('billingRenewCaption');
    if (caption) caption.textContent = renewYmd ? formatRenewCaption(renewYmd).toUpperCase() : 'AL TERMINAR LA PRUEBA';
    const amountEl = $('billingRenewAmount');
    if (amountEl) amountEl.textContent = vars.precio;
    const lead = document.querySelector('.co-lead');
    if (lead) {
      lead.innerHTML = TribuFunnel.fillCopy(copyCfg?.lead || lead.textContent, vars);
    }
    $('checkoutRenewLine').textContent = TribuFunnel.fillCopy(
      copyCfg?.renew_line || `Después, ${vars.precio} al mes con renovación automática.`,
      vars
    );
    const micro = document.querySelector('.co-summary .co-micro');
    if (micro && copyCfg?.summary_micro) micro.textContent = copyCfg.summary_micro;
    $('coForm').querySelector('h2').textContent = TribuFunnel.fillCopy(
      copyCfg?.form_title || `Empieza con ${d} días gratis.`,
      vars
    );
    $('coTermsText').textContent = TribuFunnel.fillCopy(
      copyCfg?.terms || $('coTermsText').textContent,
      vars
    );
    $('coSubmit').textContent = TribuFunnel.fillCopy(
      copyCfg?.submit || `Empezar mis ${d} días gratis`,
      vars
    );
    if (culqiPublicCfg?.modo === 'sandbox') $('coSandboxHint').style.display = 'block';
  }

  function validateForm() {
    const err = $('coError');
    err.textContent = '';
    const nombre = $('coNombre').value.trim();
    const email = $('coEmail').value.trim();
    if (!nombre || !email) {
      err.textContent = 'Completa nombre y correo.';
      return null;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      err.textContent = 'Correo electrónico inválido.';
      return null;
    }
    if (!$('coTerms').checked) {
      err.textContent = 'Debes aceptar los términos.';
      return null;
    }
    const card_number = digitsOnly($('coCardNumber').value);
    const cvv = digitsOnly($('coCvc').value);
    const exp = parseExpiration($('coExp').value);
    if (card_number.length < 13) {
      err.textContent = 'Número de tarjeta incompleto.';
      return null;
    }
    if (!exp) {
      err.textContent = 'Vencimiento inválido. Usa MM / AA.';
      return null;
    }
    if (cvv.length < 3) {
      err.textContent = 'CVC inválido.';
      return null;
    }
    if (!culqiPublicCfg?.activo || !culqiPublicCfg.public_key) {
      err.textContent = 'Los pagos no están disponibles en este momento.';
      return null;
    }
    return {
      nombre,
      email,
      card_number,
      cvv,
      expiration_month: exp.expiration_month,
      expiration_year: exp.expiration_year,
    };
  }

  async function submitTrial(tokenId, fields) {
    const utm = TribuFunnel.readUtm();
    const payload = {
      nombre: fields.nombre,
      email: fields.email,
      terms_accepted: true,
      suscripcion_id: funnelCfg.plan?.id,
      token_id: tokenId,
      utm_source: utm.utm_source,
      utm_campaign: utm.utm_campaign,
    };
    const res = await fetch(API + '/tribu-pagos/iniciar-prueba', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar la prueba');
    localStorage.setItem('tribu_token', data.token);
    localStorage.setItem('tribu_user', JSON.stringify(data.user));
    sessionStorage.setItem('tribu_trial_welcome', JSON.stringify(data.trial || {}));
    window.location.href = BASE + '/confirmacion';
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const fields = validateForm();
    if (!fields) return;

    const err = $('coError');
    const btn = $('coSubmit');
    submitting = true;
    btn.disabled = true;
    btn.textContent = 'Validando tarjeta…';

    try {
      const tokenId = await createCulqiToken(culqiPublicCfg.public_key, {
        card_number: fields.card_number,
        cvv: fields.cvv,
        expiration_month: fields.expiration_month,
        expiration_year: fields.expiration_year,
        email: fields.email,
      });
      btn.textContent = 'Activando tu prueba…';
      await submitTrial(tokenId, fields);
    } catch (ex) {
      err.textContent = ex.message || 'Error al procesar';
      btn.disabled = false;
      btn.textContent = TribuFunnel.fillCopy(
        copyCfg?.submit || `Empezar mis ${funnelCfg.trial_dias || 7} días gratis`,
        copyVars()
      );
      submitting = false;
    }
  }

  $('coCardNumber').addEventListener('input', function () { formatCardInput(this); });
  $('coExp').addEventListener('input', function () { formatExpInput(this); });
  $('coForm').addEventListener('submit', onSubmit);

  loadConfig();
})();
