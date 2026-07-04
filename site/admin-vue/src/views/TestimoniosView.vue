<template>
  <div>
    <div class="section-header">
      <div>
        <h2>⭐ Testimonios</h2>
        <p>Gestiona los testimonios que se muestran en la landing page</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" :class="seccionVisible ? 'btn-success btn-sm' : 'btn-outline btn-sm'" @click="toggleSeccion">
          {{ seccionVisible ? '👁️ Sección visible' : '🚫 Sección oculta' }}
        </button>
        <button class="btn btn-primary" @click="mostrarModal()">+ Nuevo testimonio</button>
      </div>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="table-desktop">
          <table>
            <thead><tr><th>Foto</th><th>Autor</th><th>Texto</th><th>Creado por</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              <tr v-for="t in testimonios" :key="t.id">
                <td><img v-if="t.foto_url" :src="t.foto_url" class="avatar-sm"><span v-else>—</span></td>
                <td><strong style="color:#667eea">{{ t.autor }}</strong></td>
                <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ t.texto }}</td>
                <td style="font-size:.8rem;color:#888">{{ t.creado_por_nombre || '—' }}</td>
                <td><span v-if="t.activo" class="badge badge-activo">✅ Activo</span><span v-else class="badge badge-inactivo">❌ Inactivo</span></td>
                <td>
                  <button class="btn btn-primary btn-xs" @click="editar(t)">Editar</button>
                  <button class="btn btn-danger btn-xs" @click="eliminar(t.id)">Eliminar</button>
                </td>
              </tr>
              <tr v-if="!testimonios.length">
                <td colspan="6" class="table-empty"><div class="empty-icon">⭐</div><div class="empty-text">No hay testimonios</div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mobile-cards">
          <div class="mc-item" v-for="t in testimonios" :key="'m' + t.id">
            <div class="mc-header">
              <span class="mc-title">{{ t.autor }}</span>
              <span v-if="t.activo" class="badge badge-activo">Activo</span><span v-else class="badge badge-inactivo">Inactivo</span>
            </div>
            <div class="mc-row">💬 {{ t.texto }}</div>
            <div class="mc-actions">
              <button class="btn btn-primary btn-xs" @click="editar(t)">Editar</button>
              <button class="btn btn-danger btn-xs" @click="eliminar(t.id)">Eliminar</button>
            </div>
          </div>
          <div v-if="!testimonios.length" style="text-align:center;padding:32px;color:#aaa">⭐ No hay testimonios</div>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div class="modal-overlay" :class="{ show: modalVisible }" @click.self="modalVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editando ? '✏️ Editar Testimonio' : '⭐ Nuevo Testimonio' }}</h3>
          <button class="modal-close" @click="cerrarModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group"><label>Autor</label><input type="text" v-model="form.autor" placeholder="María, 28 años"></div>
          <div class="form-group"><label>Texto del testimonio</label><textarea v-model="form.texto" rows="3" placeholder="Escribe el testimonio..."></textarea></div>
          <div class="form-group">
            <label>Foto</label>
            <div class="file-drop">
              <input type="file" accept="image/*" @change="onFotoChange">
              <div class="fd-icon">📷</div>
              <div class="fd-text">Haz clic para subir una foto</div>
            </div>
            <div class="file-preview" :style="{ display: fotoPreview ? 'flex' : 'none' }">
              <img v-if="fotoPreview" :src="fotoPreview" style="width:48px;height:48px;border-radius:50%;object-fit:cover">
              <button type="button" class="btn-remove" @click="quitarFoto">Quitar foto</button>
            </div>
          </div>
          <div class="form-group">
            <label>Estado</label>
            <select v-model.number="form.activo">
              <option :value="1">🟢 Activo</option>
              <option :value="0">🔴 Inactivo</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" @click="cerrarModal">Cancelar</button>
          <button class="btn btn-primary" @click="guardar" :disabled="guardando">{{ guardando ? 'Guardando...' : '💾 Guardar' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { apiFetch, authHeaders, formHeaders, getCookie } from '../utils/api'
import { toast } from '../utils/toast'

const testimonios = ref([])
const seccionVisible = ref(false)
const modalVisible = ref(false)
const editando = ref(false)
const guardando = ref(false)
const editandoId = ref(null)
const fotoFile = ref(null)
const fotoPreview = ref(null)
const eliminarFoto = ref(false)
const form = reactive({ autor: '', texto: '', activo: 1 })

onMounted(cargarTestimonios)

async function cargarTestimonios() {
  try {
    const [resT, resC] = await Promise.all([
      apiFetch('/testimonios/admin', { headers: authHeaders() }),
      apiFetch('/testimonios/config', { headers: authHeaders() })
    ])
    const data = await resT.json()
    const cfg = await resC.json()
    testimonios.value = data
    seccionVisible.value = cfg.seccion_activa
  } catch { toast('Error cargando testimonios', 'error') }
}

async function toggleSeccion() {
  try {
    const res = await apiFetch('/testimonios/config', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ seccion_activa: !seccionVisible.value })
    })
    if (res.ok) cargarTestimonios()
    else toast('Error al cambiar visibilidad', 'error')
  } catch { toast('Error de conexión', 'error') }
}

function mostrarModal() {
  editando.value = false
  editandoId.value = null
  form.autor = ''
  form.texto = ''
  form.activo = 1
  fotoFile.value = null
  fotoPreview.value = null
  eliminarFoto.value = false
  modalVisible.value = true
}

function editar(t) {
  editando.value = true
  editandoId.value = t.id
  form.autor = t.autor || ''
  form.texto = t.texto || ''
  form.activo = t.activo ? 1 : 0
  fotoFile.value = null
  fotoPreview.value = t.foto_url || null
  eliminarFoto.value = false
  modalVisible.value = true
}

function cerrarModal() {
  modalVisible.value = false
}

function onFotoChange(e) {
  const file = e.target.files[0]
  if (file) {
    fotoFile.value = file
    const reader = new FileReader()
    reader.onload = (ev) => { fotoPreview.value = ev.target.result }
    reader.readAsDataURL(file)
    eliminarFoto.value = false
  }
}

function quitarFoto() {
  fotoFile.value = null
  fotoPreview.value = null
  eliminarFoto.value = true
  document.querySelector('#modalTestimonio input[type="file"]').value = ''
}

async function guardar() {
  const fd = new FormData()
  fd.append('autor', form.autor)
  fd.append('texto', form.texto)
  fd.append('activo', form.activo === 1 ? 'true' : 'false')
  if (fotoFile.value) fd.append('foto', fotoFile.value)
  if (eliminarFoto.value) fd.append('eliminar_foto', 'true')
  guardando.value = true
  try {
    const url = editandoId.value ? `/testimonios/${editandoId.value}` : '/testimonios'
    const res = await apiFetch(url, {
      method: editandoId.value ? 'PUT' : 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'X-CSRF-Token': getCookie('csrf_token') || '' },
      body: fd
    })
    const data = await res.json()
    if (res.ok) { cerrarModal(); cargarTestimonios(); toast('Testimonio guardado', 'success') }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
  finally { guardando.value = false }
}

async function eliminar(id) {
  if (!confirm('¿Eliminar este testimonio?')) return
  try {
    const res = await apiFetch(`/testimonios/${id}`, { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (res.ok) { cargarTestimonios(); toast('Testimonio eliminado', 'success') }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
}
</script>
