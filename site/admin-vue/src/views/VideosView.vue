<template>
  <div>
    <div class="section-header">
      <div>
        <h2>🎬 La Tribu — Camino Interior</h2>
        <p>Videos, categorías, eventos y textos de la sección</p>
      </div>
    </div>

    <div class="sub-tabs">
      <button :class="{ active: tabActivo === 'videos' }" @click="tabActivo = 'videos'">🎬 Videos</button>
      <button :class="{ active: tabActivo === 'categorias' }" @click="tabActivo = 'categorias'">🗂️ Categorías</button>
      <button :class="{ active: tabActivo === 'landing' }" @click="tabActivo = 'landing'">📝 Textos</button>
      <button :class="{ active: tabActivo === 'eventos' }" @click="tabActivo = 'eventos'">📅 Eventos</button>
    </div>

    <!-- VIDEOS -->
    <div v-show="tabActivo === 'videos'">
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
    </div>

    <!-- CATEGORÍAS -->
    <div v-show="tabActivo === 'categorias'">
      <div style="margin-bottom:16px">
        <button class="btn btn-primary" @click="mostrarModalCategoria()">+ Nueva categoría</button>
      </div>
      <div class="card">
        <div class="card-body">
          <div class="table-desktop">
            <table>
              <thead><tr><th>Nombre</th><th>Descripción</th><th>Videos</th><th>Orden</th><th>Creado por</th><th>Activo</th><th>Acciones</th></tr></thead>
              <tbody>
                <tr v-for="c in categorias" :key="c.id">
                  <td style="color:#667eea;font-weight:500">{{ c.nombre }}</td>
                  <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.descripcion || '—' }}</td>
                  <td>{{ c.total_videos }}</td>
                  <td>{{ c.orden }}</td>
                  <td style="font-size:.8rem;color:#888">{{ c.creado_por_nombre || '—' }}</td>
                  <td>{{ c.activo ? '✅' : '❌' }}</td>
                  <td>
                    <button class="btn btn-primary btn-xs" @click="editarCategoria(c)">Editar</button>
                    <button class="btn btn-danger btn-xs" @click="eliminarCategoria(c.id)">Eliminar</button>
                  </td>
                </tr>
                <tr v-if="!categorias.length">
                  <td colspan="7" class="table-empty"><div class="empty-icon">🗂️</div><div class="empty-text">No hay categorías</div></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="mobile-cards">
            <div class="mc-item" v-for="c in categorias" :key="'m' + c.id">
              <div class="mc-header"><span class="mc-title">{{ c.nombre }}</span>{{ c.activo ? '✅' : '❌' }}</div>
              <div class="mc-row">{{ c.descripcion || 'Sin descripción' }}</div>
              <div class="mc-row">🎬 {{ c.total_videos }} videos · Orden: {{ c.orden }}</div>
              <div class="mc-actions">
                <button class="btn btn-primary btn-xs" @click="editarCategoria(c)">Editar</button>
                <button class="btn btn-danger btn-xs" @click="eliminarCategoria(c.id)">Eliminar</button>
              </div>
            </div>
            <div v-if="!categorias.length" style="text-align:center;padding:32px;color:#aaa">🗂️ No hay categorías</div>
          </div>
        </div>
      </div>
    </div>

    <!-- LANDING TEXTOS -->
    <div v-show="tabActivo === 'landing'">
      <div class="card" style="max-width:640px">
        <div class="card-header"><h3>📝 Textos de la sección</h3></div>
        <div class="card-body" style="padding:20px">
          <p style="font-size:.85rem;color:#666;margin-bottom:16px">Estos textos aparecen en la pestaña <strong>Camino Interior</strong> de La Tribu.</p>
          <div class="form-group">
            <label>Texto introductorio <span class="optional">(empieza con "Cada masterclass...")</span></label>
            <textarea v-model="landingIntro" rows="4" placeholder="Texto introductorio..."></textarea>
          </div>
          <div class="form-group">
            <label>Texto del propósito <span class="optional">(empieza con "Cada recurso...")</span></label>
            <textarea v-model="landingPacto" rows="4" placeholder="Texto del propósito..."></textarea>
          </div>
          <button class="btn btn-primary" @click="guardarLanding">💾 Guardar cambios</button>
        </div>
      </div>
    </div>

    <!-- EVENTOS -->
    <div v-show="tabActivo === 'eventos'">
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

    <!-- MODAL CATEGORÍA -->
    <div class="modal-overlay" :class="{ show: modalCategoriaVisible }" @click.self="modalCategoriaVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editandoCategoriaId ? '✏️ Editar Categoría' : '🗂️ Nueva Categoría' }}</h3>
          <button class="modal-close" @click="modalCategoriaVisible = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group"><label>Nombre</label><input type="text" v-model="cf.nombre" placeholder="Sanación Emocional"></div>
          <div class="form-group"><label>Descripción</label><textarea v-model="cf.descripcion" rows="3" placeholder="Herramientas para entender, soltar y sanar..."></textarea></div>
          <div class="form-group"><label>Orden</label><input type="number" v-model.number="cf.orden" placeholder="1" min="1"></div>
          <div class="form-group">
            <label>Estado</label>
            <select v-model.number="cf.activo">
              <option :value="1">🟢 Activo</option>
              <option :value="0">🔴 Inactivo</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" @click="modalCategoriaVisible = false">Cancelar</button>
          <button class="btn btn-primary" @click="guardarCategoria" :disabled="guardandoCategoria">{{ guardandoCategoria ? 'Guardando...' : '💾 Guardar' }}</button>
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
import { apiFetch, authHeaders, formHeaders, getCookie } from '../utils/api'
import { toast } from '../utils/toast'

const tabActivo = ref('videos')

// Videos
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

// Categorías
const modalCategoriaVisible = ref(false)
const editandoCategoriaId = ref(null)
const guardandoCategoria = ref(false)
const cf = reactive({ nombre: '', descripcion: '', orden: 1, activo: 1 })

// Landing
const landingIntro = ref('')
const landingPacto = ref('')

// Eventos
const eventos = ref([])
const eventosMes = ref(String(new Date().getMonth() + 1).padStart(2, '0'))
const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const modalEventoVisible = ref(false)
const editandoEventoId = ref(null)
const guardandoEvento = ref(false)
const modalEventoTitle = ref('📅 Nuevo Evento')
const ef = reactive({ nombre: '', fecha: '', hora_inicio: '', hora_fin: '', lugar: '', ubicacion: '', activo: 1 })

watch(tabActivo, (t) => {
  if (t === 'videos') cargarVideos()
  if (t === 'categorias') cargarCategorias()
  if (t === 'landing') cargarLanding()
  if (t === 'eventos') cargarEventos()
})

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

onMounted(() => { cargarVideos(); cargarCategorias() })

function fmtHora(t) {
  if (!t) return '—'
  return String(t).slice(0, 5)
}

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

// === VIDEOS ===
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

// === CATEGORÍAS ===
function mostrarModalCategoria() {
  editandoCategoriaId.value = null
  cf.nombre = ''
  cf.descripcion = ''
  cf.orden = 1
  cf.activo = 1
  modalCategoriaVisible.value = true
}

function editarCategoria(c) {
  editandoCategoriaId.value = c.id
  cf.nombre = c.nombre || ''
  cf.descripcion = c.descripcion || ''
  cf.orden = c.orden || 1
  cf.activo = c.activo ? 1 : 0
  modalCategoriaVisible.value = true
}

async function guardarCategoria() {
  if (!cf.nombre.trim()) return toast('El nombre es obligatorio', 'error')
  guardandoCategoria.value = true
  try {
    const body = { nombre: cf.nombre.trim(), descripcion: cf.descripcion.trim(), orden: cf.orden || 1, activo: cf.activo === 1 }
    const url = editandoCategoriaId.value ? `/videos/categorias/${editandoCategoriaId.value}` : '/videos/categorias'
    const res = await apiFetch(url, { method: editandoCategoriaId.value ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(body) })
    const data = await res.json()
    if (res.ok) { modalCategoriaVisible.value = false; cargarCategorias(); toast('Categoría guardada', 'success') }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
  finally { guardandoCategoria.value = false }
}

async function eliminarCategoria(id) {
  if (!confirm('¿Eliminar esta categoría? Los videos asociados quedarán sin categoría.')) return
  try {
    const res = await apiFetch(`/videos/categorias/${id}`, { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (res.ok) { cargarCategorias(); toast('Categoría eliminada', 'success') }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
}

// === LANDING ===
async function cargarLanding() {
  try {
    const res = await apiFetch('/videos/landing', { headers: authHeaders() })
    const cfg = await res.json()
    landingIntro.value = cfg.intro || ''
    landingPacto.value = cfg.pacto || ''
  } catch { toast('No se pudo cargar el landing', 'error') }
}

async function guardarLanding() {
  if (!landingIntro.value.trim() || !landingPacto.value.trim()) return toast('Ambos textos son obligatorios', 'error')
  try {
    const res = await apiFetch('/videos/landing', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ intro: landingIntro.value.trim(), pacto: landingPacto.value.trim() })
    })
    const d = await res.json()
    toast(res.ok ? 'Textos guardados' : (d.error || 'Error'), res.ok ? 'success' : 'error')
  } catch { toast('Error de conexión', 'error') }
}

// === EVENTOS ===
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
