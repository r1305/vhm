<template>
  <div>
    <div class="section-header">
      <div>
        <h2>👥 Administradores del sistema</h2>
        <p>Gestiona quiénes pueden acceder al panel de administración</p>
      </div>
      <button class="btn btn-primary" @click="mostrarModal()">+ Nuevo usuario</button>
    </div>
    <div class="card">
      <div class="card-body">
        <div class="table-desktop">
          <table>
            <thead><tr><th>Usuario</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              <tr v-for="u in usuarios" :key="u.id">
                <td><strong style="color:#667eea">{{ u.username }}</strong></td>
                <td>{{ u.nombre }}</td>
                <td>{{ u.email }}</td>
                <td><span class="badge" :style="u.rol === 'SUPER_ADMIN' ? 'background:#ede9fe;color:#6d28d9' : 'background:#dbeafe;color:#1d4ed8'">{{ u.rol }}</span></td>
                <td><span v-if="u.activo" class="badge badge-activo">✅ Activo</span><span v-else class="badge badge-inactivo">❌ Inactivo</span></td>
                <td>
                  <em v-if="u.es_protegido" style="font-size:.8rem;color:#aaa">Protegido</em>
                  <em v-else-if="u.rol === 'SUPER_ADMIN' && !isSuperAdmin" style="font-size:.8rem;color:#aaa">Sin permiso</em>
                  <template v-else>
                    <button class="btn btn-primary btn-xs" @click="editar(u)">Editar</button>
                    <button class="btn btn-danger btn-xs" @click="eliminar(u.id)">Eliminar</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!usuarios.length">
                <td colspan="6" class="table-empty"><div class="empty-icon">👥</div><div class="empty-text">No hay usuarios</div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mobile-cards">
          <div class="mc-item" v-for="u in usuarios" :key="'m' + u.id">
            <div class="mc-header">
              <span class="mc-title">{{ u.username }}</span>
              <span class="badge" :style="u.rol === 'SUPER_ADMIN' ? 'background:#ede9fe;color:#6d28d9' : 'background:#dbeafe;color:#1d4ed8'">{{ u.rol }}</span>
            </div>
            <div class="mc-row">👤 {{ u.nombre }}</div>
            <div class="mc-row">📧 {{ u.email }}</div>
            <div class="mc-row">{{ u.activo ? '✅ Activo' : '❌ Inactivo' }}</div>
            <div class="mc-actions">
              <em v-if="u.es_protegido" style="font-size:.8rem;color:#aaa">Protegido</em>
              <em v-else-if="u.rol === 'SUPER_ADMIN' && !isSuperAdmin" style="font-size:.8rem;color:#aaa">Sin permiso</em>
              <template v-else>
                <button class="btn btn-primary btn-xs" @click="editar(u)">Editar</button>
                <button class="btn btn-danger btn-xs" @click="eliminar(u.id)">Eliminar</button>
              </template>
            </div>
          </div>
          <div v-if="!usuarios.length" style="text-align:center;padding:32px;color:#aaa">👥 No hay usuarios</div>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div class="modal-overlay" :class="{ show: modalVisible }" @click.self="modalVisible = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editandoId ? '✏️ Editar Usuario' : '👤 Nuevo Usuario' }}</h3>
          <button class="modal-close" @click="modalVisible = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group"><label>Nombre de usuario</label><input type="text" v-model="form.username" :disabled="!!editandoId" placeholder="usuario"></div>
          <div class="form-group"><label>Nombre completo</label><input type="text" v-model="form.nombre" placeholder="Nombre del usuario"></div>
          <div class="form-group"><label>Email</label><input type="email" v-model="form.email" placeholder="usuario@correo.com"></div>
          <div class="form-group"><label>Contraseña <span class="optional">(dejar vacío para no cambiar)</span></label><input type="password" v-model="form.password" placeholder="••••••••"></div>
          <div class="form-group">
            <label>Rol</label>
            <select v-model="form.rol">
              <option value="ADMIN">Administrador</option>
              <option v-if="isSuperAdmin" value="SUPER_ADMIN">Super Admin</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" @click="modalVisible = false">Cancelar</button>
          <button class="btn btn-primary" @click="guardar" :disabled="guardando">{{ guardando ? 'Guardando...' : '💾 Guardar' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { apiFetch, authHeaders } from '../utils/api'
import { toast } from '../utils/toast'
import { useAuth } from '../composables/useAuth'

const { isSuperAdmin } = useAuth()

const usuarios = ref([])
const modalVisible = ref(false)
const editandoId = ref(null)
const guardando = ref(false)
const form = reactive({ username: '', nombre: '', email: '', password: '', rol: 'ADMIN' })

onMounted(cargarUsuarios)

async function cargarUsuarios() {
  try {
    const res = await apiFetch('/usuarios', { headers: authHeaders() })
    usuarios.value = await res.json()
  } catch { toast('Error cargando usuarios', 'error') }
}

function mostrarModal() {
  editandoId.value = null
  form.username = ''
  form.nombre = ''
  form.email = ''
  form.password = ''
  form.rol = 'ADMIN'
  modalVisible.value = true
}

function editar(u) {
  editandoId.value = u.id
  form.username = u.username
  form.nombre = u.nombre
  form.email = u.email
  form.password = ''
  form.rol = u.rol
  modalVisible.value = true
}

async function guardar() {
  if (!editandoId.value && !form.password) return toast('La contraseña es obligatoria para nuevos usuarios', 'error')
  const body = { username: form.username, nombre: form.nombre, email: form.email, rol: form.rol }
  if (form.password) body.password = form.password
  guardando.value = true
  try {
    const url = editandoId.value ? `/usuarios/${editandoId.value}` : '/usuarios'
    const res = await apiFetch(url, {
      method: editandoId.value ? 'PUT' : 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (res.ok) { modalVisible.value = false; cargarUsuarios(); toast('Usuario guardado', 'success') }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
  finally { guardando.value = false }
}

async function eliminar(id) {
  if (!confirm('¿Eliminar este usuario?')) return
  try {
    const res = await apiFetch(`/usuarios/${id}`, { method: 'DELETE', headers: authHeaders() })
    const data = await res.json()
    if (res.ok) { cargarUsuarios(); toast('Usuario eliminado', 'success') }
    else toast(data.error, 'error')
  } catch { toast('Error de conexión', 'error') }
}
</script>
