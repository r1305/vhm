<template>
  <div>
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
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { apiFetch, authHeaders } from '../../utils/api'
import { toast } from '../../utils/toast'

const categorias = ref([])
const modalCategoriaVisible = ref(false)
const editandoCategoriaId = ref(null)
const guardandoCategoria = ref(false)
const cf = reactive({ nombre: '', descripcion: '', orden: 1, activo: 1 })

onMounted(cargarCategorias)

async function cargarCategorias() {
  try {
    const res = await apiFetch('/videos/categorias/admin', { headers: authHeaders() })
    categorias.value = await res.json()
  } catch {}
}

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
</script>
