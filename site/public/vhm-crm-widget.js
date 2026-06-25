/**
 * VHM CRM Widget — vhm-crm-widget.js
 * Incluir en vhm.com.pe/site con:
 *   <script src="/site/vhm-crm-widget.js"></script>
 *
 * Captura automáticamente parámetros UTM de la URL y los envía al CRM.
 * Expone: window.VHMWidget.agendar(), window.VHMWidget.suscribir()
 */
(function () {
  'use strict';

  const CRM_BASE = 'https://vhm.com.pe/crm';
  const DEFAULT_BTN_TEXTO = '\uD83D\uDC9C Quiero una sesi\u00f3n gratuita';

  // Cargar texto del botón desde el CRM
  async function loadBtnTexto() {
    try {
      const r = await fetch(`${CRM_BASE}/api/config/public`);
      const d = await r.json();
      return d.widget_btn_texto || DEFAULT_BTN_TEXTO;
    } catch { return DEFAULT_BTN_TEXTO; }
  }

  // ── Leer UTMs de la URL ──────────────────────────────────────
  function getUTMs() {
    const p = new URLSearchParams(window.location.search);
    return {
      utm_source:   p.get('utm_source')   || document.referrer.includes('instagram') ? 'instagram' : p.get('utm_source') || '',
      utm_medium:   p.get('utm_medium')   || '',
      utm_campaign: p.get('utm_campaign') || '',
      utm_content:  p.get('utm_content')  || '',
      utm_term:     p.get('utm_term')     || '',
    };
  }

  // Persistir UTMs en sessionStorage para que sobrevivan navegación interna
  (function persistUTMs() {
    const utms = getUTMs();
    const hasAny = Object.values(utms).some(v => v);
    if (hasAny) sessionStorage.setItem('vhm_utms', JSON.stringify(utms));
  })();

  function storedUTMs() {
    try { return JSON.parse(sessionStorage.getItem('vhm_utms') || '{}'); } catch { return {}; }
  }

  // ── API helper ───────────────────────────────────────────────
  async function post(path, body) {
    const res = await fetch(`${CRM_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // ── Registrar lead ───────────────────────────────────────────
  async function capturarLead(data) {
    return post('/api/leads/web', { ...data, ...storedUTMs() });
  }

  // ── Suscribir al newsletter ──────────────────────────────────
  async function suscribir(data) {
    return post('/api/marketing/suscribir', data);
  }

  // ── CSS del widget ───────────────────────────────────────────
  const css = `
    #vhm-widget-btn {
      position: fixed; bottom: 28px; right: 24px; z-index: 9997;
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: #fff; border: none; border-radius: 50px;
      padding: 14px 22px; font-size: 14px; font-weight: 600;
      cursor: pointer; box-shadow: 0 4px 20px rgba(124,58,237,.45);
      display: flex; align-items: center; gap: 8px;
      transition: transform .2s, box-shadow .2s;
    }
    #vhm-widget-btn:hover { transform: scale(1.05); box-shadow: 0 6px 28px rgba(124,58,237,.6); }
    #vhm-widget-overlay {
      display: none; position: fixed; inset: 0; z-index: 9998;
      background: rgba(0,0,0,.6); backdrop-filter: blur(4px);
      align-items: center; justify-content: center;
    }
    #vhm-widget-overlay.open { display: flex; }
    #vhm-widget-modal {
      background: #fff; border-radius: 16px; padding: 0;
      width: 92%; max-width: 440px; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0,0,0,.3);
      animation: vhmIn .22s ease;
    }
    @keyframes vhmIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    #vhm-widget-modal .vhm-head {
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: #fff; padding: 22px 24px 18px;
    }
    #vhm-widget-modal .vhm-head h3 { font-size: 1.1rem; font-weight: 700; margin-bottom: 4px; }
    #vhm-widget-modal .vhm-head p  { font-size: .85rem; opacity: .85; }
    #vhm-widget-modal .vhm-close {
      float: right; background: none; border: none; color: #fff;
      font-size: 1.4rem; cursor: pointer; margin-top: -2px; line-height: 1;
    }
    #vhm-widget-modal .vhm-body { padding: 22px 24px; }
    .vhm-tabs { display: flex; gap: 8px; margin-bottom: 18px; }
    .vhm-tab {
      flex: 1; padding: 8px; border: 1.5px solid #e5e7eb; border-radius: 8px;
      background: transparent; font-size: 13px; font-weight: 500;
      cursor: pointer; color: #6b7280; transition: all .15s;
    }
    .vhm-tab.active { background: #7c3aed; border-color: #7c3aed; color: #fff; }
    .vhm-form { display: none; }
    .vhm-form.active { display: block; }
    .vhm-group { margin-bottom: 12px; }
    .vhm-label { display: block; font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 5px; }
    .vhm-input {
      width: 100%; padding: 9px 12px; border: 1.5px solid #e5e7eb;
      border-radius: 8px; font-size: 14px; color: #111;
      transition: border-color .15s; outline: none;
    }
    .vhm-input:focus { border-color: #7c3aed; }
    .vhm-select { width: 100%; padding: 9px 12px; border: 1.5px solid #e5e7eb; border-radius: 8px; font-size: 14px; color: #111; }
    .vhm-textarea { width: 100%; padding: 9px 12px; border: 1.5px solid #e5e7eb; border-radius: 8px; font-size: 14px; color: #111; resize: vertical; min-height: 80px; }
    .vhm-btn {
      width: 100%; padding: 11px; background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
      cursor: pointer; margin-top: 4px; transition: opacity .15s;
    }
    .vhm-btn:hover { opacity: .9; }
    .vhm-btn:disabled { opacity: .6; cursor: not-allowed; }
    .vhm-success {
      text-align: center; padding: 24px 0;
      display: none;
    }
    .vhm-success .vhm-check { font-size: 2.5rem; margin-bottom: 8px; }
    .vhm-success h4 { color: #111; font-size: 1rem; margin-bottom: 6px; }
    .vhm-success p  { color: #6b7280; font-size: .9rem; }
    .vhm-privacy { font-size: 11px; color: #9ca3af; text-align: center; margin-top: 10px; }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ── HTML del widget ──────────────────────────────────────────
  const html = `
    <button id="vhm-widget-btn">
      💜 Quiero una sesión gratuita
    </button>
    <div id="vhm-widget-overlay">
      <div id="vhm-widget-modal">
        <div class="vhm-head">
          <button class="vhm-close" id="vhm-close-btn">×</button>
          <h3>VHM — Centro de Psicología</h3>
          <p>Te acompañamos en tu proceso de sanación y crecimiento</p>
        </div>
        <div class="vhm-body">
          <div class="vhm-tabs">
            <button class="vhm-tab active" data-tab="sesion">📅 Sesión gratuita</button>
            <button class="vhm-tab" data-tab="newsletter">📩 Newsletter</button>
          </div>

          <!-- Formulario sesión informativa -->
          <div class="vhm-form active" id="vhm-form-sesion">
            <div id="vhm-success-sesion" class="vhm-success">
              <div class="vhm-check">✅</div>
              <h4>¡Recibimos tu solicitud!</h4>
              <p>Nos pondremos en contacto contigo muy pronto para confirmar tu sesión.</p>
            </div>
            <div id="vhm-fields-sesion">
              <div class="vhm-group">
                <label class="vhm-label">Nombre *</label>
                <input class="vhm-input" id="vhm-nombre" placeholder="Tu nombre">
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <div class="vhm-group">
                  <label class="vhm-label">Email</label>
                  <input type="email" class="vhm-input" id="vhm-email" placeholder="correo@ejemplo.com">
                </div>
                <div class="vhm-group">
                  <label class="vhm-label">Teléfono</label>
                  <input type="tel" class="vhm-input" id="vhm-telefono" placeholder="+51 999 999 999">
                </div>
              </div>
              <div class="vhm-group">
                <label class="vhm-label">¿Qué te trae por aquí?</label>
                <select class="vhm-select" id="vhm-motivo">
                  <option value="">— Selecciona un tema —</option>
                  <option value="ansiedad">Ansiedad / estrés</option>
                  <option value="pareja">Terapia de pareja</option>
                  <option value="ruptura">Ruptura amorosa / duelo</option>
                  <option value="autoestima">Autoestima</option>
                  <option value="infantil">Terapia infantil</option>
                  <option value="depresion">Depresión</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div class="vhm-group">
                <label class="vhm-label">Cuéntanos un poco más (opcional)</label>
                <textarea class="vhm-textarea" id="vhm-mensaje" placeholder="¿Desde cuándo sientes esto? ¿Qué esperas de la terapia?"></textarea>
              </div>
              <button class="vhm-btn" id="vhm-submit-sesion">Solicitar sesión gratuita</button>
              <p class="vhm-privacy">🔒 Tus datos son confidenciales y nunca serán compartidos.</p>
            </div>
          </div>

          <!-- Formulario newsletter -->
          <div class="vhm-form" id="vhm-form-newsletter">
            <div id="vhm-success-news" class="vhm-success">
              <div class="vhm-check">🎉</div>
              <h4>¡Estás suscrito!</h4>
              <p>Recibirás contenido de valor sobre bienestar emocional y crecimiento personal.</p>
            </div>
            <div id="vhm-fields-news">
              <div class="vhm-group">
                <label class="vhm-label">Nombre</label>
                <input class="vhm-input" id="vhm-news-nombre" placeholder="Tu nombre">
              </div>
              <div class="vhm-group">
                <label class="vhm-label">Email *</label>
                <input type="email" class="vhm-input" id="vhm-news-email" placeholder="correo@ejemplo.com">
              </div>
              <div class="vhm-group">
                <label class="vhm-label">¿Qué temas te interesan?</label>
                <select class="vhm-select" id="vhm-news-segmento">
                  <option value="">— Todos los temas —</option>
                  <option value="ansiedad">Ansiedad y estrés</option>
                  <option value="pareja">Relaciones y pareja</option>
                  <option value="autoestima">Autoestima</option>
                  <option value="duelo">Duelo y pérdidas</option>
                  <option value="infantil">Psicología infantil</option>
                </select>
              </div>
              <button class="vhm-btn" id="vhm-submit-news">Suscribirme al newsletter</button>
              <p class="vhm-privacy">📧 Solo contenido de valor. Sin spam. Puedes darte de baja cuando quieras.</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  // Aplicar texto configurable al boton
  loadBtnTexto().then(texto => {
    const btn = document.getElementById('vhm-widget-btn');
    if (btn) btn.innerHTML = texto;
  });

  // ── Lógica ───────────────────────────────────────────────────
  const overlay = document.getElementById('vhm-widget-overlay');
  const openBtn = document.getElementById('vhm-widget-btn');
  const closeBtn = document.getElementById('vhm-close-btn');

  openBtn.addEventListener('click', () => overlay.classList.add('open'));
  closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

  // Tabs
  document.querySelectorAll('.vhm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.vhm-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.vhm-form').forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`vhm-form-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Submit sesión
  document.getElementById('vhm-submit-sesion').addEventListener('click', async () => {
    const nombre = document.getElementById('vhm-nombre').value.trim();
    const email  = document.getElementById('vhm-email').value.trim();
    const tel    = document.getElementById('vhm-telefono').value.trim();
    const motivo = document.getElementById('vhm-motivo').value;
    const msg    = document.getElementById('vhm-mensaje').value.trim();

    if (!nombre) { document.getElementById('vhm-nombre').focus(); return; }

    const btn = document.getElementById('vhm-submit-sesion');
    btn.disabled = true; btn.textContent = 'Enviando…';

    try {
      await capturarLead({
        nombre, apellido: '',
        email: email || undefined,
        telefono: tel || undefined,
        motivo_consulta: motivo,
        mensaje: msg || motivo,
        fuente_detalle: window.location.href,
      });

      // Si dio email, suscribir también al newsletter
      if (email) {
        await suscribir({ email, nombre, segmento: motivo || '' }).catch(() => {});
      }

      document.getElementById('vhm-fields-sesion').style.display = 'none';
      document.getElementById('vhm-success-sesion').style.display = 'block';
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Solicitar sesión gratuita';
      alert('Hubo un error. Por favor intenta de nuevo.');
    }
  });

  // Submit newsletter
  document.getElementById('vhm-submit-news').addEventListener('click', async () => {
    const email    = document.getElementById('vhm-news-email').value.trim();
    const nombre   = document.getElementById('vhm-news-nombre').value.trim();
    const segmento = document.getElementById('vhm-news-segmento').value;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('vhm-news-email').focus(); return;
    }

    const btn = document.getElementById('vhm-submit-news');
    btn.disabled = true; btn.textContent = 'Suscribiendo…';

    try {
      await suscribir({ email, nombre, segmento });
      document.getElementById('vhm-fields-news').style.display = 'none';
      document.getElementById('vhm-success-news').style.display = 'block';
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Suscribirme al newsletter';
      alert('Hubo un error. Por favor intenta de nuevo.');
    }
  });

  // ── API pública ──────────────────────────────────────────────
  window.VHMWidget = {
    agendar: () => {
      overlay.classList.add('open');
      document.querySelector('[data-tab="sesion"]').click();
    },
    suscribir: () => {
      overlay.classList.add('open');
      document.querySelector('[data-tab="newsletter"]').click();
    },
    capturarLead,
  };

})();
