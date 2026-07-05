<template>
  <div>
    <div class="filter-row">
      <label style="font-size:.85rem;font-weight:600;color:#555">📅 Mes:</label>
      <select v-model="eventosMes">
        <option v-for="(m, i) in meses" :key="i" :value="String(i + 1).padStart(2, '0')">{{ m }}</option>
      </select>
      <button class="btn btn-primary btn-sm" @click="mostrarModalEvento()" style="margin-left:auto">+ Nuevo evento</button>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="table-desktop">
          <table>
            <thead><tr><th>Nombre</th><th>Fecha</th><th>Inicio</th><th>Fin</th><th>Lugar</th><th>Creado por</th><th>Activo</th><th>Acciones</th></tr></thead>
            <tbody>
              <tr v-for="e in eventosFiltrados" :key="e.id">
                <td style="color:#667eea;font-weight:500">{{ e.nombre }}</td>
                <td>{{ String(e.fecha).slice(0,10) }}</td>
                <td>{{ fmtHora(e.hora_inicio) }}</td>
                <td>{{ fmtHora(e.hora_fin) }}</td>
                <td>{{ e.lugar }}</td>
                <td style="font-size:.8rem;color:#888">{{ e.creado_por_nombre || '—' }}</td>
                <td>{{ e.activo ? '✅' : '❌' }}</td>
                <td>
                  <button class="btn btn-primary btn-xs" @click="editarEvento(e)">Editar</button>
                  <button class="btn btn-outline btn-xs" @click="copiarEvento(e)">Copiar</button>
                  <button class="btn btn-danger btn-xs" @click="eliminarEvento(e.id)">Eliminar</button>
                </td>
              </tr>
              <tr v-if="!eventosFiltrados.length">
                <td colspan="8" class="table-empty"><div class="empty-icon">📅</div><div class="empty-text">No hay eventos este mes</div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mobile-cards">
          <div class="mc-item" v-for="e in eventosFiltrados" :key="'m' + e.id">
            <div class="mc-header"><span class="mc-title">{{ e.nombre }}</span>{{ e.activo ? '✅' : '❌' }}</div>
            <div class="mc-row">📅 {{ String(e.fecha).slice(0,10) }} · 🕐 {{ fmtHora(e.hora_inicio) }}{{ e.hora_fin ? ' – ' + fmtHora(e.hora_fin) : '' }}</div>
            <div class="mc-row">📍 {{ e.lugar }}</div>
            <div class="mc-actions">
              <button class="btn btn-primary btn-xs" @click="editarEvento(e)">Editar</button>
              <button class="btn btn-outline btn-xs" @click="copiarEvento(e)">Copiar</button>
              <button class="btn btn-danger btn-xs" @click="eliminarEvento(e.id)">Eliminar</button>
            </div>
          </div>
          <div v-if="!eventosFiltrados.length" style="text-align:center;padding:32px;color:#aaa">📅 No hay eventos este mes</div>
        </div>
      </div>
    </div>

    <!-- MODAL EVENTO -->
    <div class="modal-overlay" :class="{ show: modalEventoVisible }" @click.self="modalEventoVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ modalEventoTitle }}</h3>
          <button class="modal-close" @click="modalEventoVisible = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group"><label>Nombre</label><input type="text" v-model="ef.nombre" placeholder="Encuentro de la tribu"></div>
          <div class="form-group"><label>Fecha</label><input type="date" v-model="ef.fecha"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group"><label>Hora inicio</label><input type="time" v-model="ef.hora_inicio"></div>
            <div class="form-group"><label>Hora fin <span class="optional">(opcional)</span></label><input type="time" v-model="ef.hora_fin"></div>
          </div>
          <div class="form-group"><label>Lugar</label><input type="text" v-model="ef.lugar" placeholder="Centro VHM, Sala principal"></div>
          <div class="form-group"><label>Link <span class="optional">(opcional)</span></label><input type="url" v-model="ef.ubicacion" placeholder="https://maps.google.com/..."></div>
          <div class="form-group">
            <label>Estado</label>
            <select v-model.number="ef.activo">
              <option :value="1">🟢 Activo</option>
              <option :value="0">🔴 Inactivo</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" @click="modalEventoVisible = false">Cancelar</button>
          <button class="btn btn-primary" @click="guardarEvento" :disabled="guardandoEvento">{{ guardandoEvento ? 'Guardando...' : '💾 Guardar' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { apiFetch, authHeaders } from '../../utils/api'
import { toast } from '../../utils/toast'

const eventos = ref([])
const eventosMes = ref(String(new Date().getMonth() + 1).padStart(2, '0'))
const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const modalEventoVisible = ref(false)
const editandoEventoId = ref(null)
const guardandoEvento = ref(false)
const modalEventoTitle = ref('📅 Nuevo Evento')
const ef = reactive({ nombre: '', fecha: '', hora_inicio: '', hora_fin: '', lugar: '', ubicacion: '', activo: 1 })

watch(eventosMes, () => cargarEventos())

const eventosFiltrados = computed(() => {
  const mes = eventosMes.value
  const anio = new Date().getFullYear()
  return eventos.value.filter(e => {
    const f = new Date(e.fecha)
    const eMes = String(f.getMonth() + 1).padStart(2, '0')
    return eMes === mes && f.getFullYear() === anio
  })
})

onMounted(cargarEventos)

function fmtHora(t) {
  if (!t) return '—'
  return String(t).slice(0, 5)
}

async function cargarEventos() {
  try {
    const res = await apiFetch('/eventos/admin', { headers: authHeaders() })
    eventos.value = await res.json()
  } catch { toast('No se pudieron cargar los eventos', 'error') }
}

function mostrarModalEvento() {
  editandoEventoId.value = null
  modalEventoTitle.value = '📅 Nuevo Evento'
  ef.nombre = ''
  ef.fecha = ''
  ef.hora_inicio = ''
  ef.hora_fin = ''
  ef.lugar = ''
  ef.ubicacion = ''
  ef.activo = 1
  modalEventoVisible.value = true
}

function copiarEvento(e) {
  modalEventoTitle.value = '📅 Nuevo Evento (copia)'
  editandoEventoId.value = null
  ef.nombre = e.nombre || ''
  ef.fecha = ''
  ef.hora_inicio = fmtHora(e.hora_inicio)
  ef.hora_fin = e.hora_fin ? fmtHora(e.hora_fin) : ''
  ef.lugar = e.lugar || ''
  ef.ubicacion = e.ubicacion || ''
  ef.activo = e.activo ? 1 : 0
  modalEventoVisible.value = true
}

function editarEvento(e) {
  modalEventoTitle.value = '✏️ Editar Evento'
  editandoEventoId.value = e.id
  ef.nombre = e.nombre || ''
  ef.fecha = String(e.fecha).slice(0, 10)
  ef.hora_inicio = fmtHora(e.hora_inicio)
  ef.hora_fin = e.hora_fin ? fmtHora(e.hora_fin) : ''
  ef.lugar = e.lugar || ''
  ef.ubicacion = e.ubicacion || ''
  ef.activo = e.activo ? 1 : 0
  modalEventoVisible.value = true
}

async function guardarEvento() {
  if (!ef.nombre || !ef.fecha || !ef.hora_inicio || !ef.lugar) return toast('Completa nombre, fecha, hora de inicio y lugar', 'error')
  guardandoEvento.value = true
  try {
    const body = {
      nombre: ef.nombre.trim(),
      fecha: ef.fecha,
      hora_inicio: ef.hora_inicio,
      hora_fin: ef.hora_fin || null,
      lugar: ef.lugar.trim(),
      ubicacion: ef.ubicacion.trim() || null,
      activo: ef.activo === 1
    }
    const url = editandoEventoId.value ? `/eventos/${editandoEventoId.value}` : '/eventos'
    const res = await apiFetch(url, { method: editandoEventoId.value ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(body) })
    const d = await res.json()
    if (res.ok) { modalEventoVisible.value = false; cargarEventos(); toast('Evento guardado', 'success') }
    else toast(d.error || 'Error al guardar', 'error')
  } catch { toast('Error de conexión', 'error') }
  finally { guardandoEvento.value = false }
}

async function eliminarEvento(id) {
  if (!confirm('¿Eliminar este evento?')) return
  try {
    const res = await apiFetch(`/eventos/${id}`, { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (res.ok) { cargarEventos(); toast('Evento eliminado', 'success') }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
}
</script>
