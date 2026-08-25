<template>
  <div>
    <div class="section-header">
      <div>
        <h2>🫂 Usuarios de La Tribu</h2>
        <p>Pacientes importados con acceso a La Tribu</p>
      </div>
    </div>
    <div class="card">
      <div class="card-body">

        <!-- Buscador + Ver por página -->
        <div class="filter-row" style="margin-bottom:16px">
          <input
            v-model="busqueda"
            @input="onBusqueda"
            type="text"
            placeholder="Buscar por nombre, correo o celular…"
            style="flex:1;min-width:200px"
          />
          <div style="display:flex;align-items:center;gap:8px;white-space:nowrap">
            <span style="font-size:.85rem;color:var(--text-muted)">Ver por página</span>
            <select v-model="perPage" @change="cargar(1)">
              <option v-for="n in [10,20,30,40,50]" :key="n" :value="n">{{ n }}</option>
            </select>
          </div>
        </div>

        <div class="table-desktop">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Teléfono</th>
                <th>Estado</th>
                <th>Suscrito</th>
                <th>Contraseña</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in usuarios" :key="u.id">
                <td><strong>{{ u.nombre }} {{ u.apellido }}</strong></td>
                <td>{{ u.email || '—' }}</td>
                <td>{{ u.telefono || '—' }}</td>
                <td><span class="badge" :style="estadoStyle(u.estado)">{{ u.estado }}</span></td>
                <td><span class="badge" :style="u.is_suscribed ? 'background:#d1fae5;color:#065f46' : 'background:#f3f4f6;color:#6b7280'">{{ u.is_suscribed ? '✅ Sí' : 'No' }}</span></td>
                <td>
                  <span v-if="!u.psw_temp" class="badge" style="background:#d1fae5;color:#065f46">Cambiada</span>
                  <button v-else class="btn btn-outline btn-xs" @click="verPassword(u)">🔑 Ver temporal</button>
                </td>
                <td style="font-size:.82rem;color:#888">{{ fmtFecha(u.created_at) }}</td>
              </tr>
              <tr v-if="!usuarios.length">
                <td colspan="7" class="table-empty">
                  <div class="empty-icon">🫂</div>
                  <div class="empty-text">No hay usuarios de La Tribu</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mobile-cards">
          <div class="mc-item" v-for="u in usuarios" :key="'m' + u.id">
            <div class="mc-header">
              <span class="mc-title">{{ u.nombre }} {{ u.apellido }}</span>
              <span class="badge" :style="u.is_suscribed ? 'background:#d1fae5;color:#065f46' : 'background:#f3f4f6;color:#6b7280'">{{ u.is_suscribed ? '✅ Suscrito' : 'No suscrito' }}</span>
            </div>
            <div class="mc-row">📧 {{ u.email || '—' }}</div>
            <div class="mc-row">📱 {{ u.telefono || '—' }}</div>
            <div class="mc-row">Estado: {{ u.estado }}</div>
            <div class="mc-row">
              Contraseña:
              <span v-if="!u.psw_temp" class="badge" style="background:#d1fae5;color:#065f46;margin-left:4px">Cambiada</span>
              <button v-else class="btn btn-outline btn-xs" style="margin-left:4px" @click="verPassword(u)">🔑 Ver</button>
            </div>
            <div class="mc-row" style="font-size:.8rem;color:#888">{{ fmtFecha(u.created_at) }}</div>
          </div>
          <div v-if="!usuarios.length" style="text-align:center;padding:32px;color:#aaa">🫂 No hay usuarios</div>
        </div>

        <!-- Paginación -->
        <div v-if="totalPages > 1" style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:20px;flex-wrap:wrap">
          <button class="btn btn-secondary" :disabled="page === 1" @click="cargar(page - 1)">‹ Anterior</button>
          <template v-for="p in paginasVisibles" :key="p">
            <span v-if="p === '...'" style="padding:0 4px;color:#9ca3af">…</span>
            <button v-else class="btn" :class="p === page ? 'btn-primary' : 'btn-secondary'" @click="cargar(p)">{{ p }}</button>
          </template>
          <button class="btn btn-secondary" :disabled="page === totalPages" @click="cargar(page + 1)">Siguiente ›</button>
        </div>
        <div style="text-align:center;font-size:.8rem;color:#9ca3af;margin-top:8px" v-if="total > 0">
          {{ total }} usuario{{ total !== 1 ? 's' : '' }} en total
        </div>

      </div>
    </div>

    <!-- Modal contraseña temporal -->
    <div class="modal-overlay" :class="{ show: modalPswVisible }" @click.self="modalPswVisible = false">
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <h3>🔑 Contraseña temporal</h3>
          <button class="modal-close" @click="modalPswVisible = false">✕</button>
        </div>
        <div class="modal-body" style="text-align:center;padding:28px 24px">
          <div style="font-size:.9rem;color:var(--text-muted);margin-bottom:12px">{{ pswUsuario }}</div>
          <div v-if="pswCargando" style="color:var(--text-muted)">Cargando…</div>
          <div v-else-if="pswValor" style="display:flex;align-items:center;justify-content:center;gap:10px">
            <code style="font-size:1.4rem;font-weight:700;letter-spacing:3px;color:var(--color-primary);background:var(--bg-input);padding:10px 20px;border-radius:10px;border:1px solid var(--border-strong)">{{ pswVisible ? pswValor : '•'.repeat(pswValor.length) }}</code>
            <button @click="pswVisible = !pswVisible" style="background:none;border:none;cursor:pointer;font-size:1.3rem" :title="pswVisible ? 'Ocultar' : 'Mostrar'">{{ pswVisible ? '🙈' : '👁️' }}</button>
          </div>
          <div v-else style="color:var(--color-danger);font-size:.9rem">No se encontró la contraseña temporal.</div>
          <button v-if="pswValor" class="btn btn-outline btn-sm" style="margin-top:16px" @click="copiarPsw">📋 Copiar</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { apiFetch, authHeaders } from '../utils/api'
import { toast } from '../utils/toast'

const usuarios   = ref([])
const busqueda   = ref('')
const perPage    = ref(10)
const page       = ref(1)
const total      = ref(0)
const totalPages = ref(1)

const modalPswVisible = ref(false)
const pswUsuario      = ref('')
const pswValor        = ref('')
const pswVisible      = ref(false)
const pswCargando     = ref(false)

let debounceTimer = null

async function cargar(p = 1) {
  page.value = p;
  try {
    const params = new URLSearchParams({ page: p, limit: perPage.value })
    if (busqueda.value.trim()) params.set('q', busqueda.value.trim())
    const res  = await apiFetch(`/tribu-users?${params}`, { headers: authHeaders() })
    const data = await res.json()
    usuarios.value   = data.data
    total.value      = data.total
    totalPages.value = data.totalPages
  } catch { toast('Error cargando usuarios de La Tribu', 'error') }
}

async function verPassword(u) {
  pswUsuario.value  = `${u.nombre} ${u.apellido}`
  pswValor.value    = ''
  pswVisible.value  = false
  pswCargando.value = true
  modalPswVisible.value = true
  try {
    const res  = await apiFetch(`/tribu-users/${u.id}/password-temp`, { headers: authHeaders() })
    const data = await res.json()
    pswValor.value = data.password || ''
  } catch { toast('Error al obtener contraseña', 'error') }
  finally { pswCargando.value = false }
}

function copiarPsw() {
  if (!pswValor.value) return
  navigator.clipboard.writeText(pswValor.value).then(() => toast('Contraseña copiada', 'success'))
}

function onBusqueda() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => cargar(1), 350)
}

const paginasVisibles = computed(() => {
  const tp = totalPages.value, cp = page.value, pages = []
  for (let i = 1; i <= tp; i++) {
    if (i === 1 || i === tp || (i >= cp - 2 && i <= cp + 2)) pages.push(i)
    else if (pages[pages.length - 1] !== '...') pages.push('...')
  }
  return pages
})

onMounted(() => cargar())

function estadoStyle(estado) {
  const map = {
    activo:      'background:#d1fae5;color:#065f46',
    prospecto:   'background:#dbeafe;color:#1d4ed8',
    alta:        'background:#ede9fe;color:#6d28d9',
    inactivo:    'background:#f3f4f6;color:#6b7280',
    lista_espera:'background:#fef3c7;color:#92400e',
  }
  return map[estado] || 'background:#f3f4f6;color:#6b7280'
}

function fmtFecha(val) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
}
</script>
