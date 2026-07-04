<template>
  <div>
    <div class="stats-row" style="grid-template-columns: repeat(4, 1fr);">
      <div class="stat-card">
        <div class="stat-icon">📋</div>
        <div class="stat-label">Total reclamos</div>
        <div class="stat-value">{{ stats.total }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⏳</div>
        <div class="stat-label">Pendientes</div>
        <div class="stat-value">{{ stats.pendientes }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🔄</div>
        <div class="stat-label">En proceso</div>
        <div class="stat-value">{{ stats.proceso }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">✅</div>
        <div class="stat-label">Resueltos</div>
        <div class="stat-value">{{ stats.resueltos }}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>📋 Reclamos recibidos</h3>
      </div>
      <div class="card-body">
        <div class="table-desktop">
          <table>
            <thead>
              <tr>
                <th>N° Reclamo</th><th>Fecha</th><th>Cliente</th><th>Tipo</th>
                <th>Estado</th><th>Resp.</th><th>Respondió</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in reclamos" :key="r.id">
                <td><strong style="color:#667eea">{{ r.numero_reclamo }}</strong></td>
                <td>{{ formatDate(r.fecha_registro) }}</td>
                <td>{{ r.nombres }} {{ r.apellidos }}</td>
                <td>{{ r.tipo_reclamo }}</td>
                <td><span :class="'badge badge-' + r.estado.toLowerCase()">{{ r.estado }}</span></td>
                <td>{{ r.respuesta ? '✅ Sí' : '⏳ No' }}</td>
                <td style="font-size:.8rem;color:#888">{{ r.respondido_por_nombre || '—' }}</td>
                <td>
                  <button class="btn btn-primary btn-xs" @click="verDetalle(r)">Ver</button>
                  <a class="btn btn-success btn-xs" :href="apiUrl('/reclamos/' + r.id + '/pdf')" target="_blank" style="text-decoration:none">PDF</a>
                  <button v-if="r.respuesta" class="btn btn-outline btn-xs" @click="reenviarCorreo(r.id)">📧</button>
                  <button v-if="isSuperAdmin" class="btn btn-danger btn-xs" @click="eliminarReclamo(r.id)">🗑</button>
                </td>
              </tr>
              <tr v-if="!reclamos.length">
                <td colspan="8" class="table-empty">
                  <div class="empty-icon">📋</div>
                  <div class="empty-text">No hay reclamos</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mobile-cards">
          <div class="mc-item" v-for="r in reclamos" :key="'m' + r.id">
            <div class="mc-header">
              <span class="mc-title">{{ r.numero_reclamo }}</span>
              <span :class="'badge badge-' + r.estado.toLowerCase()">{{ r.estado }}</span>
            </div>
            <div class="mc-row">📅 {{ formatDate(r.fecha_registro) }}</div>
            <div class="mc-row">👤 {{ r.nombres }} {{ r.apellidos }}</div>
            <div class="mc-row">📌 {{ r.tipo_reclamo }} · {{ r.respuesta ? '✅ Respondido' : '⏳ Pendiente' }}</div>
            <div class="mc-actions">
              <button class="btn btn-primary btn-xs" @click="verDetalle(r)">Ver</button>
              <a class="btn btn-success btn-xs" :href="apiUrl('/reclamos/' + r.id + '/pdf')" target="_blank" style="text-decoration:none">📄 PDF</a>
              <button v-if="r.respuesta" class="btn btn-outline btn-xs" @click="reenviarCorreo(r.id)">📧 Reenviar</button>
              <button v-if="isSuperAdmin" class="btn btn-danger btn-xs" @click="eliminarReclamo(r.id)">🗑 Eliminar</button>
            </div>
          </div>
          <div v-if="!reclamos.length" style="text-align:center;padding:32px;color:#aaa">📋 No hay reclamos</div>
        </div>
      </div>
      <div class="pagination">
        <button @click="cambiarPagina(-1)" :disabled="currentPage <= 1">← Anterior</button>
        <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
        <button @click="cambiarPagina(1)" :disabled="currentPage >= totalPages">Siguiente →</button>
      </div>
    </div>

    <!-- Modal detalle -->
    <div class="modal-overlay" :class="{ show: detalleVisible }" @click.self="detalleVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>📄 Detalle del Reclamo</h3>
          <button class="modal-close" @click="detalleVisible = false">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="detalle">
            <div class="detail-grid">
              <div class="detail-item"><div class="detail-label">N° Reclamo</div><div class="detail-value">{{ detalle.numero_reclamo }}</div></div>
              <div class="detail-item"><div class="detail-label">Fecha</div><div class="detail-value">{{ formatDateTime(detalle.fecha_registro) }}</div></div>
              <div class="detail-item"><div class="detail-label">Cliente</div><div class="detail-value">{{ detalle.nombres }} {{ detalle.apellidos }}</div></div>
              <div class="detail-item"><div class="detail-label">Documento</div><div class="detail-value">{{ detalle.tipo_documento }}: {{ detalle.numero_documento }}</div></div>
              <div class="detail-item"><div class="detail-label">Email</div><div class="detail-value">{{ detalle.email }}</div></div>
              <div class="detail-item"><div class="detail-label">Teléfono</div><div class="detail-value">{{ detalle.telefono }}</div></div>
              <div class="detail-item"><div class="detail-label">Dirección</div><div class="detail-value">{{ detalle.direccion }}, {{ detalle.distrito }}</div></div>
              <div class="detail-item"><div class="detail-label">Tipo Bien</div><div class="detail-value">{{ detalle.tipo_bien }}</div></div>
              <div class="detail-item"><div class="detail-label">Monto</div><div class="detail-value">S/ {{ Number(detalle.monto_reclamado).toFixed(2) }}</div></div>
              <div class="detail-item"><div class="detail-label">Estado</div><div class="detail-value"><span :class="'badge badge-' + detalle.estado.toLowerCase()">{{ detalle.estado }}</span></div></div>
            </div>
            <div class="detail-full"><div class="detail-label">Descripción del bien</div><div class="detail-value">{{ detalle.descripcion_bien }}</div></div>
            <div class="detail-full"><div class="detail-label">Detalle del reclamo</div><div class="detail-value">{{ detalle.detalle_reclamo }}</div></div>
            <div class="detail-full"><div class="detail-label">Pedido del consumidor</div><div class="detail-value">{{ detalle.pedido_consumidor }}</div></div>
            <div v-if="detalle.respuesta" class="respuesta-box">
              <span class="rb-label">✅ Respuesta enviada ({{ formatDateTime(detalle.fecha_respuesta) }}):</span>
              <div class="rb-text">{{ detalle.respuesta }}</div>
            </div>
          </div>
          <div class="response-section" v-if="detalle && (!detalle.respuesta || isSuperAdmin)">
            <label>Responder al reclamo:</label>
            <textarea v-model="respuestaText" rows="4" placeholder="Escribe la respuesta que se notificará al cliente..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" @click="detalleVisible = false">Cancelar</button>
          <button class="btn btn-primary" @click="enviarRespuesta" :disabled="enviando">
            {{ enviando ? 'Enviando...' : '📨 Enviar respuesta y notificar' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { apiFetch, authHeaders } from '../utils/api'
import { toast } from '../utils/toast'
import { useAuth } from '../composables/useAuth'

const { isSuperAdmin } = useAuth()

const reclamos = ref([])
const currentPage = ref(1)
const totalPages = ref(1)
const stats = reactive({ total: '—', pendientes: '—', proceso: '—', resueltos: '—' })
const detalleVisible = ref(false)
const detalle = ref(null)
const respuestaText = ref('')
const enviando = ref(false)

function apiUrl(path) {
  const base = (window.__APP_BASE__ || '').replace(/\/+$/, '')
  const apiBase = (base && !window.location.pathname.startsWith(base + '/') && window.location.pathname !== base)
    ? '/api'
    : (base || '') + '/api'
  return apiBase + path
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('es-PE')
}
function formatDateTime(d) {
  return new Date(d).toLocaleString('es-PE')
}

async function cargarReclamos() {
  try {
    const res = await apiFetch(`/reclamos?page=${currentPage.value}&limit=10`, { headers: authHeaders() })
    const data = await res.json()
    reclamos.value = data.data || []
    totalPages.value = data.totalPages || 1
    stats.total = data.total || 0
    stats.pendientes = data.data.filter(r => r.estado === 'PENDIENTE').length
    stats.proceso = data.data.filter(r => r.estado === 'EN_PROCESO').length
    stats.resueltos = data.data.filter(r => r.estado === 'RESUELTO').length
  } catch {
    toast('Error cargando reclamos', 'error')
  }
}

function cambiarPagina(dir) {
  currentPage.value += dir
  if (currentPage.value < 1) currentPage.value = 1
  cargarReclamos()
}

async function verDetalle(r) {
  try {
    const res = await apiFetch(`/reclamos/${r.id}`, { headers: authHeaders() })
    detalle.value = await res.json()
    respuestaText.value = detalle.value.respuesta || ''
    detalleVisible.value = true
  } catch {
    toast('Error cargando detalle', 'error')
  }
}

async function enviarRespuesta() {
  if (!respuestaText.value.trim()) return toast('Escribe una respuesta', 'error')
  enviando.value = true
  try {
    const res = await apiFetch(`/reclamos/${detalle.value.id}/responder`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ respuesta: respuestaText.value.trim() })
    })
    const data = await res.json()
    if (res.ok) {
      toast(`Respuesta registrada. ${data.emailEnviado ? 'Email enviado al cliente.' : 'No se pudo enviar el email.'}`, 'success')
      detalleVisible.value = false
      cargarReclamos()
    } else {
      toast(data.error, 'error')
    }
  } catch {
    toast('Error de conexión', 'error')
  } finally {
    enviando.value = false
  }
}

async function eliminarReclamo(id) {
  if (!confirm('¿Eliminar este reclamo? Esta acción no se puede deshacer.')) return
  try {
    const res = await apiFetch(`/reclamos/${id}`, { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (res.ok) { toast('Reclamo eliminado', 'success'); cargarReclamos() }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
}

async function reenviarCorreo(id) {
  if (!confirm('¿Reenviar la respuesta por correo al cliente?')) return
  try {
    const res = await apiFetch(`/reclamos/${id}/reenviar`, { method: 'POST', headers: authHeaders() })
    const data = await res.json()
    if (res.ok) toast(data.message, 'success')
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
}

onMounted(cargarReclamos)
</script>
