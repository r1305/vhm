<template>
  <div>
    <div class="filter-row">
      <input type="text" v-model="videoSearch" placeholder="Buscar por título..." style="width:180px" @keypress.enter="buscarVideos">
      <select v-model="videoCategory">
        <option value="">Todas las categorías</option>
        <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option>
      </select>
      <button class="btn btn-primary btn-sm" @click="buscarVideos">🔍 Buscar</button>
      <button class="btn btn-primary btn-sm" @click="mostrarModalVideo()" style="margin-left:auto">+ Nuevo video</button>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="table-desktop">
          <table>
            <thead>
              <tr>
                <th></th>
                <th style="cursor:pointer" @click="sortVideos('titulo')">Título <span>{{ sortIcon('titulo') }}</span></th>
                <th style="cursor:pointer" @click="sortVideos('categoria_nombre')">Categoría <span>{{ sortIcon('categoria_nombre') }}</span></th>
                <th style="cursor:pointer" @click="sortVideos('duracion')">Duración <span>{{ sortIcon('duracion') }}</span></th>
                <th style="cursor:pointer" @click="sortVideos('vistas')">Vistas <span>{{ sortIcon('vistas') }}</span></th>
                <th style="cursor:pointer" @click="sortVideos('likes')">Likes <span>{{ sortIcon('likes') }}</span></th>
                <th>Activo</th><th>Creado por</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in videos" :key="v.id">
                <td><img v-if="v.thumbnail_url" :src="v.thumbnail_url" class="thumb"><span v-else>🎬</span></td>
                <td style="color:#667eea;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">{{ v.titulo }}</td>
                <td>{{ v.categoria_nombre || '—' }}</td>
                <td>{{ v.duracion || '—' }}</td>
                <td>{{ v.vistas }}</td>
                <td>{{ v.likes }}</td>
                <td>{{ v.activo ? '✅' : '❌' }}</td>
                <td style="font-size:.8rem;color:#888">{{ v.creado_por_nombre || '—' }}</td>
                <td>
                  <button class="btn btn-primary btn-xs" @click="editarVideo(v)">Editar</button>
                  <button class="btn btn-danger btn-xs" @click="eliminarVideo(v.id)">Eliminar</button>
                </td>
              </tr>
              <tr v-if="!videos.length">
                <td colspan="9" class="table-empty"><div class="empty-icon">🎬</div><div class="empty-text">No hay videos</div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mobile-cards">
          <div class="mc-item" v-for="v in videos" :key="'m' + v.id">
            <div class="mc-header">
              <span class="mc-title">{{ v.titulo }}</span>
              {{ v.activo ? '✅' : '❌' }}
            </div>
            <div class="mc-row">🗂️ {{ v.categoria_nombre || 'Sin categoría' }} · ⏱️ {{ v.duracion || '—' }}</div>
            <div class="mc-row">👁️ {{ v.vistas }} vistas · ❤️ {{ v.likes }} likes</div>
            <div class="mc-actions">
              <button class="btn btn-primary btn-xs" @click="editarVideo(v)">Editar</button>
              <button class="btn btn-danger btn-xs" @click="eliminarVideo(v.id)">Eliminar</button>
            </div>
          </div>
          <div v-if="!videos.length" style="text-align:center;padding:32px;color:#aaa">🎬 No hay videos</div>
        </div>
      </div>
      <div class="pagination" style="border-top:none;padding-top:0">
        <button @click="changeVideoPage(-1)" :disabled="videoPage <= 1">←</button>
        <span class="page-info">Pág. {{ videoPage }} de {{ videoTotalPages }}</span>
        <button @click="changeVideoPage(1)" :disabled="videoPage >= videoTotalPages">→</button>
      </div>
    </div>

    <!-- MODAL VIDEO -->
    <div class="modal-overlay" :class="{ show: modalVideoVisible }" @click.self="modalVideoVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editandoVideoId ? '✏️ Editar Video' : '🎬 Nuevo Video' }}</h3>
          <button class="modal-close" @click="modalVideoVisible = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group"><label>Título <span class="optional">(opcional con Loom)</span></label><input type="text" v-model="vf.titulo" placeholder="Déjalo vacío para usar el de Loom"></div>
          <div class="form-group"><label>Subtítulo / etiqueta</label><input type="text" v-model="vf.subtitulo" placeholder="Masterclass completa + Ronda de preguntas"></div>
          <div class="form-group">
            <label>Categoría</label>
            <select v-model="vf.categoria_id">
              <option value="">— Sin categoría —</option>
              <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nombre }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>Enlace del video</label>
            <input type="text" v-model="vf.video_url" placeholder="https://www.loom.com/share/...">
            <div class="field-hint">Loom, YouTube, Vimeo o enlace directo a MP4</div>
          </div>
          <div class="form-group"><label>Duración <span class="optional">(se autocompleta en Loom)</span></label><input type="text" v-model="vf.duracion" placeholder="1h 25min"></div>
          <div class="form-group"><label>Descripción</label><textarea v-model="vf.descripcion" rows="3" placeholder="Breve descripción del recurso..."></textarea></div>
          <div class="form-group">
            <label>Miniatura <span class="optional">(opcional)</span></label>
            <div class="file-drop">
              <input type="file" accept="image/*" @change="onThumbChange">
              <div class="fd-icon">🖼️</div>
              <div class="fd-text">Haz clic para subir miniatura</div>
            </div>
            <div class="file-preview" :style="{ display: thumbPreview ? 'flex' : 'none' }">
              <img v-if="thumbPreview" :src="thumbPreview" style="width:100px;height:56px;border-radius:6px;object-fit:cover">
              <button type="button" class="btn-remove" @click="quitarThumb">Quitar miniatura</button>
            </div>
          </div>
          <div class="form-group">
            <label>Estado</label>
            <select v-model.number="vf.activo">
              <option :value="1">🟢 Activo</option>
              <option :value="0">🔴 Inactivo</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" @click="modalVideoVisible = false">Cancelar</button>
          <button class="btn btn-primary" @click="guardarVideo" :disabled="guardandoVideo">{{ guardandoVideo ? 'Guardando...' : '💾 Guardar' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { apiFetch, authHeaders, getCookie } from '../../utils/api'
import { toast } from '../../utils/toast'

const videos = ref([])
const videoSearch = ref('')
const videoCategory = ref('')
const videoSort = ref('titulo')
const videoOrder = ref('asc')
const videoPage = ref(1)
const videoTotalPages = ref(1)
const categorias = ref([])
const modalVideoVisible = ref(false)
const editandoVideoId = ref(null)
const guardandoVideo = ref(false)
const thumbFile = ref(null)
const thumbPreview = ref(null)
const eliminarThumb = ref(false)
const vf = reactive({ titulo: '', subtitulo: '', categoria_id: '', video_url: '', duracion: '', descripcion: '', activo: 1 })

onMounted(() => { cargarVideos(); cargarCategorias() })

function sortIcon(col) {
  if (videoSort.value !== col) return ''
  return videoOrder.value === 'asc' ? '▲' : '▼'
}

function sortVideos(col) {
  if (videoSort.value === col) {
    videoOrder.value = videoOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    videoSort.value = col
    videoOrder.value = 'asc'
  }
  videoPage.value = 1
  cargarVideos()
}

function buscarVideos() {
  videoPage.value = 1
  cargarVideos()
}

function changeVideoPage(delta) {
  videoPage.value += delta
  if (videoPage.value < 1) videoPage.value = 1
  cargarVideos()
}

async function cargarVideos() {
  try {
    const res = await apiFetch(`/videos/admin?search=${encodeURIComponent(videoSearch.value)}&categoria_id=${encodeURIComponent(videoCategory.value)}&sort=${videoSort.value}&order=${videoOrder.value}&page=${videoPage.value}&limit=10`, { headers: authHeaders() })
    const data = await res.json()
    videos.value = data.data || []
    videoTotalPages.value = data.totalPages || 1
  } catch { toast('Error cargando videos', 'error') }
}

async function cargarCategorias() {
  try {
    const res = await apiFetch('/videos/categorias/admin', { headers: authHeaders() })
    categorias.value = await res.json()
  } catch {}
}

function mostrarModalVideo() {
  editandoVideoId.value = null
  Object.assign(vf, { titulo: '', subtitulo: '', categoria_id: '', video_url: '', duracion: '', descripcion: '', activo: 1 })
  thumbFile.value = null
  thumbPreview.value = null
  eliminarThumb.value = false
  modalVideoVisible.value = true
}

function editarVideo(v) {
  editandoVideoId.value = v.id
  vf.titulo = v.titulo || ''
  vf.subtitulo = v.subtitulo || ''
  vf.categoria_id = v.categoria_id || ''
  vf.video_url = v.video_url || ''
  vf.duracion = v.duracion || ''
  vf.descripcion = v.descripcion || ''
  vf.activo = v.activo ? 1 : 0
  thumbFile.value = null
  thumbPreview.value = v.thumbnail_url || null
  eliminarThumb.value = false
  modalVideoVisible.value = true
}

function onThumbChange(e) {
  const file = e.target.files[0]
  if (file) {
    thumbFile.value = file
    const reader = new FileReader()
    reader.onload = (ev) => { thumbPreview.value = ev.target.result }
    reader.readAsDataURL(file)
    eliminarThumb.value = false
  }
}

function quitarThumb() {
  thumbFile.value = null
  thumbPreview.value = null
  eliminarThumb.value = true
}

async function guardarVideo() {
  if (!vf.video_url) return toast('El enlace del video es obligatorio', 'error')
  const esLoom = /loom\.com\/(?:share|embed)\/[0-9a-f]{32}/i.test(vf.video_url)
  if (!vf.titulo && !esLoom) return toast('El título es obligatorio (solo se autocompleta con Loom)', 'error')
  const fd = new FormData()
  fd.append('titulo', vf.titulo)
  fd.append('subtitulo', vf.subtitulo)
  fd.append('categoria_id', vf.categoria_id)
  fd.append('video_url', vf.video_url)
  fd.append('duracion', vf.duracion)
  fd.append('descripcion', vf.descripcion)
  fd.append('activo', String(vf.activo))
  if (thumbFile.value) fd.append('thumbnail', thumbFile.value)
  if (eliminarThumb.value) fd.append('eliminar_thumbnail', 'true')
  guardandoVideo.value = true
  try {
    const url = editandoVideoId.value ? `/videos/${editandoVideoId.value}` : '/videos'
    const res = await apiFetch(url, {
      method: editandoVideoId.value ? 'PUT' : 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'X-CSRF-Token': getCookie('csrf_token') || '' },
      body: fd
    })
    const data = await res.json()
    if (res.ok) { modalVideoVisible.value = false; cargarVideos(); toast('Video guardado', 'success') }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
  finally { guardandoVideo.value = false }
}

async function eliminarVideo(id) {
  if (!confirm('¿Eliminar este video?')) return
  try {
    const res = await apiFetch(`/videos/${id}`, { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (res.ok) { cargarVideos(); toast('Video eliminado', 'success') }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
}
</script>
