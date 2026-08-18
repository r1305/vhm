<template>
  <div>
    <div class="section-header">
      <div>
        <h2>⚙️ Configuración</h2>
        <p>Ajusta el correo SMTP, Pixel, WhatsApp y redes sociales</p>
      </div>
    </div>

    <div class="sub-tabs">
      <button :class="{ active: tabActivo === 'email' }" @click="tabActivo = 'email'">📧 Email SMTP</button>
      <button :class="{ active: tabActivo === 'pixel' }" @click="tabActivo = 'pixel'">📊 Pixel Meta</button>
      <button :class="{ active: tabActivo === 'whatsapp' }" @click="tabActivo = 'whatsapp'">💬 WhatsApp</button>
      <button :class="{ active: tabActivo === 'redes' }" @click="tabActivo = 'redes'">🌐 Redes Sociales</button>
      <button :class="{ active: tabActivo === 'facebook' }" @click="tabActivo = 'facebook'">🔗 Facebook</button>
      <button :class="{ active: tabActivo === 'suscripciones' }" @click="tabActivo = 'suscripciones'">💳 Suscripciones</button>
    </div>

    <!-- EMAIL -->
    <div v-show="tabActivo === 'email'">
      <div class="config-grid">
        <div class="config-section">
          <h3>📧 Configuración de Correo SMTP</h3>
          <div class="form-group">
            <label>Servidor SMTP (Host)</label>
            <input type="text" v-model="email.host" placeholder="smtp.tudominio.com">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group"><label>Puerto</label><input type="number" v-model.number="email.port" placeholder="465"></div>
            <div class="form-group">
              <label>Seguridad</label>
              <select v-model.number="email.secure">
                <option :value="1">SSL/TLS</option>
                <option :value="0">STARTTLS</option>
              </select>
            </div>
          </div>
          <div class="form-group"><label>Usuario / Email SMTP</label><input type="text" v-model="email.user" placeholder="noreply@tudominio.com"></div>
          <div class="form-group"><label>Contraseña SMTP <span class="optional">(dejar vacío para no cambiar)</span></label><input type="password" v-model="email.pass" placeholder="••••••••"></div>
          <div class="form-group"><label>Email remitente (From)</label><input type="email" v-model="email.from" placeholder="noreply@tudominio.com"></div>
          <div class="form-group"><label>Nombre remitente</label><input type="text" v-model="email.nombreFrom" placeholder="VHM - Libro de Reclamaciones"></div>
          <div style="font-size:.8rem;color:#aaa">{{ email.fechaActualizacion }}</div>
          <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
            <button class="btn btn-primary" @click="guardarEmail" :disabled="guardandoEmail">{{ guardandoEmail ? 'Guardando...' : '💾 Guardar configuración' }}</button>
            <button class="btn btn-outline" @click="modalTestEmailVisible = true">📤 Enviar correo de prueba</button>
          </div>
        </div>
      </div>
    </div>

    <!-- PIXEL -->
    <div v-show="tabActivo === 'pixel'">
      <div class="config-grid">
        <div class="config-section">
          <h3>📊 Pixel de Meta (Facebook)</h3>
          <div class="form-group">
            <label>ID del Pixel</label>
            <input type="text" v-model="pixel.id" placeholder="123456789012345">
            <div class="field-hint">ID numérico de tu pixel de Meta/Facebook</div>
          </div>
          <div class="form-group">
            <label>Estado del Pixel</label>
            <select v-model.number="pixel.activo">
              <option :value="1">🟢 Activo</option>
              <option :value="0">🔴 Inactivo</option>
            </select>
          </div>
          <div style="font-size:.8rem;color:#aaa">{{ pixel.fechaActualizacion }}</div>
          <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
            <button class="btn btn-primary" @click="guardarPixel" :disabled="guardandoPixel">{{ guardandoPixel ? 'Guardando...' : '💾 Guardar configuración' }}</button>
          </div>
          <div :class="['msg-box', { success: pixelMsg.ok, error: !pixelMsg.ok }]" v-if="pixelMsg.texto" style="display:block;margin-top:12px">{{ pixelMsg.texto }}</div>
          <div class="info-box" style="margin-top:20px">
            <h4>ℹ️ Información del Pixel</h4>
            <p>El pixel de Meta se agrega automáticamente al landing page para rastrear visitantes y conversiones. Puedes encontrar tu ID de pixel en el Administrador de Eventos de Facebook Business.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- WHATSAPP -->
    <div v-show="tabActivo === 'whatsapp'">
      <div class="config-grid">
        <div class="config-section">
          <h3>💬 Configuración de WhatsApp</h3>
          <div class="form-group">
            <label>Número de WhatsApp</label>
            <input type="text" v-model="wa.numero" placeholder="51999999999">
            <div class="field-hint">Código de país sin + ni espacios (ej: 51999999999)</div>
          </div>
          <div class="form-group"><label>Mensaje predeterminado</label><input type="text" v-model="wa.mensaje" placeholder="Hola, me gustaría obtener más información..."></div>
          <div class="form-group">
            <label>Estado del botón flotante</label>
            <select v-model.number="wa.activo">
              <option :value="1">🟢 Activo</option>
              <option :value="0">🔴 Inactivo</option>
            </select>
          </div>
          <div style="font-size:.8rem;color:#aaa">{{ wa.fechaActualizacion }}</div>
          <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
            <button class="btn btn-primary" @click="guardarWhatsapp" :disabled="guardandoWhatsapp">{{ guardandoWhatsapp ? 'Guardando...' : '💾 Guardar configuración' }}</button>
          </div>
          <div :class="['msg-box', { success: waMsg.ok, error: !waMsg.ok }]" v-if="waMsg.texto" style="display:block;margin-top:12px">{{ waMsg.texto }}</div>
        </div>
      </div>
    </div>

    <!-- REDES SOCIALES -->
    <div v-show="tabActivo === 'redes'">
      <div class="config-grid">
        <div class="config-section">
          <h3>🌐 Redes Sociales</h3>
          <p style="font-size:.85rem;color:#666;margin-bottom:20px">Ingresa los enlaces de tus redes. Solo se mostrarán en la landing las que tengan un enlace.</p>
          <div class="form-group"><label>📷 Instagram</label><input type="url" v-model="redes.instagram" placeholder="https://www.instagram.com/tu_usuario"></div>
          <div class="form-group"><label>👍 Facebook</label><input type="url" v-model="redes.facebook" placeholder="https://www.facebook.com/tu_pagina"></div>
          <div class="form-group"><label>▶️ YouTube</label><input type="url" v-model="redes.youtube" placeholder="https://www.youtube.com/@tu_canal"></div>
          <div class="form-group"><label>🎵 TikTok</label><input type="url" v-model="redes.tiktok" placeholder="https://www.tiktok.com/@tu_usuario"></div>
          <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
            <button class="btn btn-primary" @click="guardarRedes" :disabled="guardandoRedes">{{ guardandoRedes ? 'Guardando...' : '💾 Guardar redes' }}</button>
          </div>
          <div :class="['msg-box', { success: redesMsg.ok, error: !redesMsg.ok }]" v-if="redesMsg.texto" style="display:block;margin-top:12px">{{ redesMsg.texto }}</div>
        </div>
      </div>
    </div>

    <!-- FACEBOOK VERIFICATION -->
    <div v-show="tabActivo === 'facebook'">
      <div class="config-grid">
        <div class="config-section">
          <h3>🔗 Verificación de Dominio (Meta)</h3>
          <div class="form-group">
            <label>Meta Domain Verification ID</label>
            <input type="text" v-model="fb.id" placeholder="334wyp3xdemukzfa4bjajet3wbw4w6">
            <div class="field-hint">Código de verificación de dominio proporcionado por Meta (Facebook/Instagram). Se inyecta como <code>&lt;meta name="facebook-domain-verification"&gt;</code> en el landing.</div>
          </div>
          <div style="font-size:.8rem;color:#aaa">{{ fb.fechaActualizacion }}</div>
          <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
            <button class="btn btn-primary" @click="guardarFacebook" :disabled="guardandoFacebook">{{ guardandoFacebook ? 'Guardando...' : '💾 Guardar' }}</button>
          </div>
          <div :class="['msg-box', { success: fbMsg.ok, error: !fbMsg.ok }]" v-if="fbMsg.texto" style="display:block;margin-top:12px">{{ fbMsg.texto }}</div>
          <div class="info-box" style="margin-top:20px">
            <h4>ℹ️ ¿Cómo obtener este código?</h4>
            <p>1. Ve al <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer">Panel de Desarrolladores de Meta</a>.</p>
            <p>2. Selecciona tu aplicación.</p>
            <p>3. Ve a <strong>Configuración → Básico</strong>.</p>
            <p>4. En "Verificación de dominio", agrega tu dominio y copia el código meta.</p>
            <p>5. Pega solo el valor del <code>content</code> en el campo de arriba.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- SUSCRIPCIONES -->
    <div v-show="tabActivo === 'suscripciones'">
      <div class="config-grid">
        <div class="config-section">
          <h3>💳 Planes de Suscripción</h3>
          <div class="form-group" style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
            <label style="margin:0">Mostrar sección en la landing</label>
            <label class="switch">
              <input type="checkbox" v-model="sus.visible" @change="guardarConfigSus">
              <span class="slider"></span>
            </label>
            <span style="font-size:.85rem;color:#aaa">{{ sus.visible ? '🟢 Visible' : '🔴 Oculta' }}</span>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <strong>Planes ({{ sus.planes.length }})</strong>
            <button class="btn btn-primary" @click="abrirModalSus(null)">+ Agregar plan</button>
          </div>

          <table v-if="sus.planes.length" style="width:100%;border-collapse:collapse;font-size:.9rem">
            <thead>
              <tr style="border-bottom:1px solid #333;color:#aaa">
                <th style="text-align:left;padding:8px 4px">Nombre</th>
                <th style="text-align:right;padding:8px 4px">Precio</th>
                <th style="text-align:left;padding:8px 4px">Descripción</th>
                <th style="padding:8px 4px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in sus.planes" :key="p.id" style="border-bottom:1px solid #1a1a1a">
                <td style="padding:10px 4px">{{ p.nombre }}</td>
                <td style="padding:10px 4px;text-align:right">S/ {{ Number(p.precio).toFixed(2) }}</td>
                <td style="padding:10px 4px;color:#aaa">{{ p.descripcion }}</td>
                <td style="padding:10px 4px;white-space:nowrap;text-align:right">
                  <button class="btn btn-outline" style="padding:4px 10px;font-size:.8rem;margin-right:6px" @click="abrirModalSus(p)">✏️</button>
                  <button class="btn btn-outline" style="padding:4px 10px;font-size:.8rem;color:#e55" @click="eliminarPlan(p.id)">🗑️</button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else style="color:#666;font-size:.9rem">No hay planes registrados.</p>

          <div :class="['msg-box', { success: susMsg.ok, error: !susMsg.ok }]" v-if="susMsg.texto" style="display:block;margin-top:12px">{{ susMsg.texto }}</div>
        </div>
      </div>
    </div>

    <!-- MODAL SUSCRIPCIÓN -->
    <div class="modal-overlay" :class="{ show: modalSusVisible }" @click.self="modalSusVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ susForm.id ? '✏️ Editar plan' : '➕ Nuevo plan' }}</h3>
          <button class="modal-close" @click="modalSusVisible = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group"><label>Nombre</label><input type="text" v-model="susForm.nombre" placeholder="Plan Base"></div>
          <div class="form-group"><label>Precio (S/)</label><input type="number" step="0.01" min="0" v-model.number="susForm.precio" placeholder="39.90"></div>
          <div class="form-group"><label>Descripción</label><input type="text" v-model="susForm.descripcion" placeholder="Próximamente"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" @click="modalSusVisible = false">Cancelar</button>
          <button class="btn btn-primary" @click="guardarPlan" :disabled="guardandoSus">{{ guardandoSus ? 'Guardando...' : '💾 Guardar' }}</button>
        </div>
      </div>
    </div>

    <!-- MODAL CORREO PRUEBA -->
    <div class="modal-overlay" :class="{ show: modalTestEmailVisible }" @click.self="modalTestEmailVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>📧 Enviar Correo de Prueba</h3>
          <button class="modal-close" @click="modalTestEmailVisible = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Correo de destino</label>
            <input type="email" v-model="testEmail.email" placeholder="ejemplo@correo.com">
          </div>
          <div class="form-group">
            <label>Mensaje de prueba</label>
            <textarea v-model="testEmail.mensaje" rows="4" placeholder="Escribe el mensaje de prueba..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" @click="modalTestEmailVisible = false">Cancelar</button>
          <button class="btn btn-primary" @click="enviarTestEmail" :disabled="enviandoTest">{{ enviandoTest ? 'Enviando...' : '📨 Enviar' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import { apiFetch, authHeaders } from '../utils/api'
import { toast } from '../utils/toast'

const tabActivo = ref('email')

// Suscripciones
const sus = reactive({ visible: false, planes: [] })
const susMsg = reactive({ texto: '', ok: false })
const modalSusVisible = ref(false)
const guardandoSus = ref(false)
const susForm = reactive({ id: null, nombre: '', precio: '', descripcion: '' })

// Email config
const email = reactive({ host: '', port: 465, secure: 1, user: '', pass: '', from: '', nombreFrom: '', fechaActualizacion: '' })
const guardandoEmail = ref(false)

// Pixel
const pixel = reactive({ id: '', activo: 0, fechaActualizacion: '' })
const guardandoPixel = ref(false)
const pixelMsg = reactive({ texto: '', ok: false })

// WhatsApp
const wa = reactive({ numero: '', mensaje: '', activo: 0, fechaActualizacion: '' })
const guardandoWhatsapp = ref(false)
const waMsg = reactive({ texto: '', ok: false })

// Redes
const redes = reactive({ instagram: '', facebook: '', youtube: '', tiktok: '' })
const guardandoRedes = ref(false)
const redesMsg = reactive({ texto: '', ok: false })

// Facebook verification
const fb = reactive({ id: '', fechaActualizacion: '' })
const guardandoFacebook = ref(false)
const fbMsg = reactive({ texto: '', ok: false })

// Test email modal
const modalTestEmailVisible = ref(false)
const testEmail = reactive({ email: '', mensaje: '' })
const enviandoTest = ref(false)

watch(tabActivo, (t) => {
  if (t === 'email') cargarEmail()
  if (t === 'pixel') cargarPixel()
  if (t === 'whatsapp') cargarWhatsapp()
  if (t === 'redes') cargarRedes()
  if (t === 'facebook') cargarFacebook()
  if (t === 'suscripciones') cargarSuscripciones()
})

onMounted(cargarEmail)

function fmtFecha(d) {
  if (!d) return ''
  return `Última actualización: ${new Date(d).toLocaleString('es-PE')}`
}

// === EMAIL ===
async function cargarEmail() {
  try {
    const res = await apiFetch('/config-email', { headers: authHeaders() })
    const d = await res.json()
    email.host = d.smtp_host || ''
    email.port = d.smtp_port || 465
    email.secure = d.smtp_secure !== undefined ? Number(d.smtp_secure) : 1
    email.user = d.smtp_user || ''
    email.from = d.email_from || ''
    email.nombreFrom = d.nombre_from || ''
    email.fechaActualizacion = d.fecha_actualizacion ? fmtFecha(d.fecha_actualizacion) : ''
  } catch { toast('Error al cargar configuración', 'error') }
}

async function guardarEmail() {
  guardandoEmail.value = true
  try {
    const res = await apiFetch('/config-email', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        smtp_host: email.host,
        smtp_port: email.port,
        smtp_secure: email.secure === 1,
        smtp_user: email.user,
        smtp_pass: email.pass,
        email_from: email.from,
        nombre_from: email.nombreFrom
      })
    })
    const d = await res.json()
    if (res.ok) toast('Configuración guardada', 'success')
    else toast(d.error, 'error')
  } catch { toast('Error de conexión', 'error') }
  finally { guardandoEmail.value = false }
}

async function enviarTestEmail() {
  if (!testEmail.email || !testEmail.mensaje) return toast('Completa todos los campos', 'error')
  enviandoTest.value = true
  try {
    const res = await apiFetch('/config-email/test', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email: testEmail.email, mensaje: testEmail.mensaje })
    })
    const d = await res.json()
    if (res.ok) { toast(`Correo enviado a ${testEmail.email}`, 'success'); modalTestEmailVisible.value = false; testEmail.email = ''; testEmail.mensaje = '' }
    else toast(d.error, 'error')
  } catch { toast('Error de conexión', 'error') }
  finally { enviandoTest.value = false }
}

// === PIXEL ===
async function cargarPixel() {
  try {
    const res = await apiFetch('/config-pixel', { headers: authHeaders() })
    const d = await res.json()
    pixel.id = d.pixel_id || ''
    pixel.activo = d.activo !== undefined ? (d.activo ? 1 : 0) : 0
    pixel.fechaActualizacion = d.fecha_actualizacion ? fmtFecha(d.fecha_actualizacion) : ''
  } catch { mostrarMsg(pixelMsg, 'Error al cargar', false) }
}

async function guardarPixel() {
  guardandoPixel.value = true
  try {
    const body = { pixel_id: pixel.id.trim(), activo: pixel.activo === 1 }
    const res = await apiFetch('/config-pixel', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) })
    const d = await res.json()
    mostrarMsg(pixelMsg, res.ok ? d.message : d.error, res.ok)
    if (res.ok) cargarPixel()
  } catch { mostrarMsg(pixelMsg, 'Error de conexión', false) }
  finally { guardandoPixel.value = false }
}

// === WHATSAPP ===
async function cargarWhatsapp() {
  try {
    const res = await apiFetch('/config-whatsapp', { headers: authHeaders() })
    const d = await res.json()
    wa.numero = d.numero || ''
    wa.mensaje = d.mensaje || ''
    wa.activo = d.activo !== undefined ? (d.activo ? 1 : 0) : 0
    wa.fechaActualizacion = d.fecha_actualizacion ? fmtFecha(d.fecha_actualizacion) : ''
  } catch { mostrarMsg(waMsg, 'Error al cargar', false) }
}

async function guardarWhatsapp() {
  guardandoWhatsapp.value = true
  try {
    const body = { numero: wa.numero.trim(), mensaje: wa.mensaje.trim(), activo: wa.activo === 1 }
    const res = await apiFetch('/config-whatsapp', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) })
    const d = await res.json()
    mostrarMsg(waMsg, res.ok ? d.message : d.error, res.ok)
    if (res.ok) cargarWhatsapp()
  } catch { mostrarMsg(waMsg, 'Error de conexión', false) }
  finally { guardandoWhatsapp.value = false }
}

// === REDES ===
async function cargarRedes() {
  try {
    const res = await apiFetch('/config-redes', { headers: authHeaders() })
    const d = await res.json()
    redes.instagram = d.instagram || ''
    redes.facebook = d.facebook || ''
    redes.youtube = d.youtube || ''
    redes.tiktok = d.tiktok || ''
  } catch { toast('Error al cargar redes', 'error') }
}

async function guardarRedes() {
  guardandoRedes.value = true
  try {
    const body = { instagram: redes.instagram.trim(), facebook: redes.facebook.trim(), youtube: redes.youtube.trim(), tiktok: redes.tiktok.trim() }
    const res = await apiFetch('/config-redes', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) })
    const d = await res.json()
    if (res.ok) toast(d.message || 'Redes guardadas', 'success')
    else toast(d.error || 'Error', 'error')
  } catch { toast('Error de conexión', 'error') }
  finally { guardandoRedes.value = false }
}

// === FACEBOOK VERIFICATION ===
async function cargarFacebook() {
  try {
    const res = await apiFetch('/config-facebook-verification', { headers: authHeaders() })
    const d = await res.json()
    fb.id = d.facebook_domain_verification || ''
    fb.fechaActualizacion = d.fecha_actualizacion ? fmtFecha(d.fecha_actualizacion) : ''
  } catch { mostrarMsg(fbMsg, 'Error al cargar', false) }
}

async function guardarFacebook() {
  guardandoFacebook.value = true
  try {
    const body = { facebook_domain_verification: fb.id.trim() }
    const res = await apiFetch('/config-facebook-verification', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) })
    const d = await res.json()
    mostrarMsg(fbMsg, res.ok ? d.message : d.error, res.ok)
    if (res.ok) cargarFacebook()
  } catch { mostrarMsg(fbMsg, 'Error de conexión', false) }
  finally { guardandoFacebook.value = false }
}

// === SUSCRIPCIONES ===
async function cargarSuscripciones() {
  try {
    const [resCfg, resPlanes] = await Promise.all([
      apiFetch('/suscripciones/config', { headers: authHeaders() }),
      apiFetch('/suscripciones', { headers: authHeaders() })
    ])
    const cfg = await resCfg.json()
    const planes = await resPlanes.json()
    sus.visible = !!cfg.activo
    sus.planes = Array.isArray(planes) ? planes : []
  } catch { mostrarMsg(susMsg, 'Error al cargar suscripciones', false) }
}

async function guardarConfigSus() {
  try {
    const res = await apiFetch('/suscripciones/config', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ activo: sus.visible }) })
    const d = await res.json()
    mostrarMsg(susMsg, res.ok ? d.message : d.error, res.ok)
  } catch { mostrarMsg(susMsg, 'Error de conexión', false) }
}

function abrirModalSus(plan) {
  if (plan) { susForm.id = plan.id; susForm.nombre = plan.nombre; susForm.precio = plan.precio; susForm.descripcion = plan.descripcion || '' }
  else { susForm.id = null; susForm.nombre = ''; susForm.precio = ''; susForm.descripcion = '' }
  susMsg.texto = ''
  modalSusVisible.value = true
}

async function guardarPlan() {
  if (!susForm.nombre || susForm.precio === '') return mostrarMsg(susMsg, 'Nombre y precio son obligatorios', false)
  guardandoSus.value = true
  try {
    const body = { nombre: susForm.nombre, precio: susForm.precio, descripcion: susForm.descripcion }
    const url = susForm.id ? `/suscripciones/${susForm.id}` : '/suscripciones'
    const method = susForm.id ? 'PUT' : 'POST'
    const res = await apiFetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
    const d = await res.json()
    if (res.ok) { modalSusVisible.value = false; cargarSuscripciones(); toast(susForm.id ? 'Plan actualizado' : 'Plan creado', 'success') }
    else mostrarMsg(susMsg, d.error, false)
  } catch { mostrarMsg(susMsg, 'Error de conexión', false) }
  finally { guardandoSus.value = false }
}

async function eliminarPlan(id) {
  if (!confirm('¿Eliminar este plan?')) return
  try {
    const res = await apiFetch(`/suscripciones/${id}`, { method: 'DELETE', headers: authHeaders() })
    if (res.ok) { cargarSuscripciones(); toast('Plan eliminado', 'success') }
    else { const d = await res.json(); toast(d.error, 'error') }
  } catch { toast('Error de conexión', 'error') }
}

function mostrarMsg(target, texto, ok) {
  target.texto = texto
  target.ok = ok
}
</script>
