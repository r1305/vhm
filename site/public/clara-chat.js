/*
 * Widget de chat "Clara · Tu Guía 24/7" para VHM.
 *
 * Modo A (por defecto): burbuja flotante que abre el GPT de Clara en una
 *   ventana emergente tipo mini-navegador (no requiere API key).
 * Modo B (opcional): si el backend tiene configurada la API de OpenAI
 *   (variable OPENAI_API_KEY), el widget muestra un chat embebido que
 *   conversa dentro de la propia página llamando a /api/clara/chat.
 *
 * El widget consulta /api/clara/config al abrirse y decide el modo solo.
 */
(function () {
  'use strict';

  var API = (window.__APP_BASE__ || '') + '/api';
  var CLARA_URL = 'https://chatgpt.com/g/g-68fbdd94f4908191bf4bc65b8e92d540-clara-tu-guia-24-7-by-ps-guillermo';

  var configCargada = false;
  var modoApi = false; // true => chat embebido (Opción B)
  var mensajes = [];   // historial para el modo API

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html != null) n.innerHTML = html;
    return n;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Estilos ----------
  var css = '' +
    '.clara-launcher{position:fixed;bottom:24px;right:24px;width:62px;height:62px;border-radius:50%;border:none;cursor:pointer;z-index:9998;' +
    'background:linear-gradient(135deg,#a855f7 0%,#ec4899 55%,#fb7185 100%);box-shadow:0 10px 30px -8px rgba(236,72,153,.7);' +
    'display:flex;align-items:center;justify-content:center;transition:transform .2s, box-shadow .2s;animation:claraPulse 2.6s ease-in-out infinite;}' +
    '.clara-launcher:hover{transform:scale(1.08);box-shadow:0 14px 36px -8px rgba(236,72,153,.85);}' +
    '.clara-launcher svg{width:30px;height:30px;}' +
    '.clara-launcher .clara-badge{position:absolute;top:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:#2dd4bf;border:2px solid #07070d;}' +
    '@keyframes claraPulse{0%,100%{box-shadow:0 10px 30px -8px rgba(236,72,153,.7),0 0 0 0 rgba(236,72,153,.45);}50%{box-shadow:0 10px 30px -8px rgba(236,72,153,.7),0 0 0 12px rgba(236,72,153,0);}}' +

    '.clara-panel{position:fixed;bottom:98px;right:24px;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 130px);' +
    'background:#101019;border:1px solid rgba(168,85,247,.25);border-radius:20px;z-index:9999;overflow:hidden;display:none;flex-direction:column;' +
    'box-shadow:0 30px 70px -20px rgba(0,0,0,.7);font-family:"Nunito",system-ui,sans-serif;color:#ece9f5;}' +
    '.clara-panel.open{display:flex;animation:claraIn .25s ease;}' +
    '@keyframes claraIn{from{opacity:0;transform:translateY(16px) scale(.98);}to{opacity:1;transform:none;}}' +

    '.clara-head{padding:16px 16px;display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,#a855f7,#ec4899 60%,#fb7185);position:relative;}' +
    '.clara-head img{width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.6);background:#fff;}' +
    '.clara-head .clara-h-name{font-weight:800;font-size:1.02rem;color:#fff;line-height:1.1;}' +
    '.clara-head .clara-h-sub{font-size:.76rem;color:rgba(255,255,255,.9);display:flex;align-items:center;gap:6px;margin-top:3px;}' +
    '.clara-head .clara-dot{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 0 3px rgba(52,211,153,.3);}' +
    '.clara-head .clara-close{position:absolute;top:12px;right:12px;background:rgba(0,0,0,.2);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:1.2rem;line-height:1;}' +
    '.clara-head .clara-close:hover{background:rgba(0,0,0,.4);}' +

    '.clara-body{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:12px;background:' +
    'radial-gradient(420px 240px at 90% 0%,rgba(236,72,153,.10),transparent 60%),radial-gradient(420px 260px at 0% 100%,rgba(56,189,248,.08),transparent 60%),#0c0c14;}' +
    '.clara-msg{max-width:84%;padding:11px 14px;border-radius:16px;font-size:.92rem;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;}' +
    '.clara-msg.bot{align-self:flex-start;background:#1b1b27;border:1px solid rgba(168,85,247,.18);border-bottom-left-radius:5px;color:#ece9f5;}' +
    '.clara-msg.user{align-self:flex-end;background:linear-gradient(135deg,#a855f7,#ec4899);border-bottom-right-radius:5px;color:#fff;}' +
    '.clara-typing{align-self:flex-start;display:flex;gap:5px;padding:12px 14px;background:#1b1b27;border-radius:16px;border-bottom-left-radius:5px;}' +
    '.clara-typing span{width:7px;height:7px;border-radius:50%;background:#a855f7;animation:claraBlink 1.2s infinite;}' +
    '.clara-typing span:nth-child(2){animation-delay:.2s;}.clara-typing span:nth-child(3){animation-delay:.4s;}' +
    '@keyframes claraBlink{0%,60%,100%{opacity:.3;}30%{opacity:1;}}' +

    '.clara-cta{margin-top:6px;padding:14px;border-radius:16px;background:#1b1b27;border:1px solid rgba(168,85,247,.18);}' +
    '.clara-cta p{font-size:.85rem;color:#b9b2cf;line-height:1.5;margin-bottom:12px;}' +
    '.clara-open-btn{display:block;width:100%;padding:13px;border:none;border-radius:12px;cursor:pointer;font-weight:800;font-size:.95rem;color:#fff;' +
    'background:linear-gradient(135deg,#a855f7,#ec4899 60%,#fb7185);box-shadow:0 8px 22px -8px rgba(236,72,153,.7);transition:transform .15s;}' +
    '.clara-open-btn:hover{transform:translateY(-2px);}' +
    '.clara-note{font-size:.72rem;color:#7a738f;margin-top:10px;text-align:center;line-height:1.4;}' +

    '.clara-foot{padding:12px;border-top:1px solid rgba(168,85,247,.18);display:flex;gap:8px;background:#101019;}' +
    '.clara-foot textarea{flex:1;resize:none;max-height:96px;min-height:44px;padding:11px 12px;border-radius:12px;border:1px solid rgba(168,85,247,.25);' +
    'background:#16161f;color:#ece9f5;font-family:inherit;font-size:.9rem;outline:none;}' +
    '.clara-foot textarea:focus{border-color:#ec4899;}' +
    '.clara-send{width:44px;height:44px;flex:none;border:none;border-radius:12px;cursor:pointer;color:#fff;font-size:1.1rem;' +
    'background:linear-gradient(135deg,#a855f7,#ec4899);display:flex;align-items:center;justify-content:center;}' +
    '.clara-send:disabled{opacity:.5;cursor:default;}' +
    '.clara-disclaimer{font-size:.68rem;color:#6f6885;text-align:center;padding:0 12px 10px;background:#101019;}' +

    '@media (max-width:520px){.clara-panel{right:12px;left:12px;width:auto;bottom:90px;height:calc(100vh - 120px);}}';

  var style = el('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- Estructura ----------
  var launcher = el('button', { 'class': 'clara-launcher', 'aria-label': 'Abrir chat con Clara', 'title': 'Chatea con Clara' });
  launcher.innerHTML = '<span class="clara-badge"></span>' +
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 3C7.03 3 3 6.58 3 11c0 1.94.78 3.71 2.08 5.08-.14 1.2-.6 2.3-1.32 3.2-.2.25-.02.62.3.6 1.6-.12 3.06-.6 4.27-1.36.83.25 1.72.38 2.67.38 4.97 0 9-3.58 9-8s-4.03-8-9-8z" fill="#fff"/>' +
    '<circle cx="8.5" cy="11" r="1.2" fill="#a855f7"/><circle cx="12" cy="11" r="1.2" fill="#ec4899"/><circle cx="15.5" cy="11" r="1.2" fill="#fb7185"/></svg>';

  var panel = el('div', { 'class': 'clara-panel', 'role': 'dialog', 'aria-label': 'Chat con Clara' });
  panel.innerHTML =
    '<div class="clara-head">' +
      '<img src="logo_vhm.jpeg" alt="Clara">' +
      '<div>' +
        '<div class="clara-h-name">Clara</div>' +
        '<div class="clara-h-sub"><span class="clara-dot"></span> Tu Guía 24/7 · by Ps. Guillermo</div>' +
      '</div>' +
      '<button class="clara-close" aria-label="Cerrar">&times;</button>' +
    '</div>' +
    '<div class="clara-body" id="claraBody"></div>' +
    '<div id="claraFootMount"></div>';

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  var body = panel.querySelector('#claraBody');
  var footMount = panel.querySelector('#claraFootMount');
  var closeBtn = panel.querySelector('.clara-close');

  function addMsg(text, who) {
    var m = el('div', { 'class': 'clara-msg ' + who });
    m.textContent = text;
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  }

  function abrirPopup() {
    var w = 440, h = 760;
    var left = Math.max(0, (window.screen.width || 1280) - w - 30);
    var top = Math.max(0, ((window.screen.height || 800) - h) / 2);
    var feats = 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
      ',menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes';
    window.open(CLARA_URL, 'ClaraChat', feats);
  }

  // ---------- Modo A: ventana emergente ----------
  function renderModoPopup() {
    body.innerHTML = '';
    addMsg('Hola, soy Clara, tu guía de acompañamiento emocional. Estoy aquí para escucharte y orientarte, las 24 horas. 💜', 'bot');
    var cta = el('div', { 'class': 'clara-cta' });
    cta.innerHTML =
      '<p>Pulsa el botón para abrir tu conversación con Clara en una ventana de chat segura.</p>' +
      '<button class="clara-open-btn" type="button">Abrir chat con Clara</button>' +
      '<div class="clara-note">Se abrirá una ventana de chat. Si es tu primera vez, puede pedirte iniciar sesión en ChatGPT.</div>';
    body.appendChild(cta);
    cta.querySelector('.clara-open-btn').addEventListener('click', abrirPopup);
    footMount.innerHTML = '';
  }

  // ---------- Modo B: chat embebido vía API ----------
  function renderModoApi() {
    body.innerHTML = '';
    mensajes = [];
    addMsg('Hola, soy Clara, tu guía de acompañamiento emocional. ¿Cómo te sientes hoy? Cuéntame en qué puedo ayudarte. 💜', 'bot');
    footMount.innerHTML =
      '<div class="clara-foot">' +
        '<textarea id="claraInput" rows="1" placeholder="Escribe tu mensaje..." maxlength="2000"></textarea>' +
        '<button class="clara-send" id="claraSend" aria-label="Enviar">&#10148;</button>' +
      '</div>' +
      '<div class="clara-disclaimer">Clara es una IA de acompañamiento y no sustituye atención psicológica profesional.</div>';

    var input = footMount.querySelector('#claraInput');
    var sendBtn = footMount.querySelector('#claraSend');

    function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 96) + 'px'; }
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
    });
    sendBtn.addEventListener('click', enviar);

    function enviar() {
      var texto = input.value.trim();
      if (!texto) return;
      input.value = ''; autosize();
      addMsg(texto, 'user');
      mensajes.push({ role: 'user', content: texto });
      sendBtn.disabled = true; input.disabled = true;

      var typing = el('div', { 'class': 'clara-typing' }, '<span></span><span></span><span></span>');
      body.appendChild(typing); body.scrollTop = body.scrollHeight;

      fetch(API + '/clara/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: mensajes })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          typing.remove();
          if (res.ok && res.d.respuesta) {
            addMsg(res.d.respuesta, 'bot');
            mensajes.push({ role: 'assistant', content: res.d.respuesta });
          } else {
            addMsg(res.d.error || 'Lo siento, ahora mismo no puedo responder. Intenta de nuevo en un momento.', 'bot');
          }
        }).catch(function () {
          typing.remove();
          addMsg('Hubo un problema de conexión. Por favor, inténtalo de nuevo.', 'bot');
        }).then(function () {
          sendBtn.disabled = false; input.disabled = false; input.focus();
        });
    }
    setTimeout(function () { input.focus(); }, 50);
  }

  function asegurarConfig() {
    if (configCargada) { return Promise.resolve(); }
    return fetch(API + '/clara/config').then(function (r) { return r.json(); })
      .then(function (cfg) { modoApi = !!(cfg && cfg.enabled); })
      .catch(function () { modoApi = false; })
      .then(function () { configCargada = true; });
  }

  function abrir() {
    panel.classList.add('open');
    launcher.style.display = 'none';
    asegurarConfig().then(function () {
      if (!body.dataset.rendered) {
        if (modoApi) renderModoApi(); else renderModoPopup();
        body.dataset.rendered = '1';
      }
    });
  }
  function cerrar() {
    panel.classList.remove('open');
    launcher.style.display = 'flex';
  }

  launcher.addEventListener('click', abrir);
  closeBtn.addEventListener('click', cerrar);
})();
