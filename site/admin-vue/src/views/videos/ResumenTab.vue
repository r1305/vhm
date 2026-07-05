<template>
  <div>
    <div class="filter-row">
      <label style="font-size:.85rem;font-weight:600;color:#555">📅 Desde:</label>
      <input type="date" v-model="fechaDesde" :max="fechaHasta || undefined" />
      <label style="font-size:.85rem;font-weight:600;color:#555">Hasta:</label>
      <input type="date" v-model="fechaHasta" :min="fechaDesde || undefined" />
      <button class="btn btn-primary btn-sm" @click="cargarStats">Filtrar</button>
      <button class="btn btn-outline btn-sm" @click="limpiarFiltros">Limpiar</button>
    </div>
    <div class="summary-cards">
      <div class="card summary-card"><div class="sc-icon">🎬</div><div class="sc-num">{{ stats.totalVideos }}</div><div class="sc-label">Videos</div></div>
      <div class="card summary-card"><div class="sc-icon">👁️</div><div class="sc-num">{{ nFmt(stats.totalViews) }}</div><div class="sc-label">Vistas totales</div></div>
      <div class="card summary-card"><div class="sc-icon">❤️</div><div class="sc-num">{{ nFmt(stats.totalLikes) }}</div><div class="sc-label">Likes totales</div></div>
      <div class="card summary-card"><div class="sc-icon">📊</div><div class="sc-num">{{ stats.totalVideos ? (stats.totalViews / stats.totalVideos).toFixed(1) : '—' }}</div><div class="sc-label">Prom. vistas/video</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div class="card"><div class="card-header"><h3>🔝 Más vistos</h3></div><div class="card-body" style="padding:12px">
        <div v-if="stats.topByViews?.length">
          <div v-for="(v, i) in stats.topByViews" :key="'vw' + v.id" class="top-row">
            <span class="top-rank">{{ i + 1 }}</span>
            <span class="top-title">{{ v.titulo }}</span>
            <span class="top-num">{{ nFmt(v.vistas) }}</span>
          </div>
        </div>
        <div v-else class="table-empty"><div class="empty-icon">👁️</div><div class="empty-text">Sin datos</div></div>
      </div></div>
      <div class="card"><div class="card-header"><h3>🔝 Más gustados</h3></div><div class="card-body" style="padding:12px">
        <div v-if="stats.topByLikes?.length">
          <div v-for="(v, i) in stats.topByLikes" :key="'lk' + v.id" class="top-row">
            <span class="top-rank">{{ i + 1 }}</span>
            <span class="top-title">{{ v.titulo }}</span>
            <span class="top-num">❤️ {{ nFmt(v.likes) }}</span>
          </div>
        </div>
        <div v-else class="table-empty"><div class="empty-icon">❤️</div><div class="empty-text">Sin datos</div></div>
      </div></div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { apiFetch, authHeaders } from '../../utils/api'
import { toast } from '../../utils/toast'

const fechaDesde = ref('')
const fechaHasta = ref('')
const stats = reactive({ totalVideos: 0, totalViews: 0, totalLikes: 0, topByViews: [], topByLikes: [] })

function nFmt(n) { return (n || 0).toLocaleString('es') }

onMounted(cargarStats)

async function cargarStats() {
  try {
    const params = new URLSearchParams()
    if (fechaDesde.value) params.set('fecha_desde', fechaDesde.value)
    if (fechaHasta.value) params.set('fecha_hasta', fechaHasta.value)
    const qs = params.toString()
    const res = await apiFetch(`/videos/stats${qs ? '?' + qs : ''}`, { headers: authHeaders() })
    const d = await res.json()
    stats.totalVideos = d.totalVideos
    stats.totalViews = d.totalViews
    stats.totalLikes = d.totalLikes
    stats.topByViews = d.topByViews || []
    stats.topByLikes = d.topByLikes || []
  } catch { toast('No se pudieron cargar las estadísticas', 'error') }
}

function limpiarFiltros() {
  fechaDesde.value = ''
  fechaHasta.value = ''
  cargarStats()
}
</script>

<style scoped>
.summary-cards { display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px }
.summary-card { text-align:center;padding:24px 12px }
.sc-icon { font-size:2rem;margin-bottom:6px }
.sc-num { font-size:1.6rem;font-weight:700;color:#667eea }
.sc-label { font-size:.8rem;color:#888;margin-top:2px }
.top-row { display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #f0f0f0 }
.top-row:last-child { border-bottom:none }
.top-rank { width:22px;height:22px;border-radius:50%;background:#667eea;color:#fff;font-size:.75rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0 }
.top-title { flex:1;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
.top-num { font-size:.85rem;font-weight:600;color:#555;white-space:nowrap }
</style>
