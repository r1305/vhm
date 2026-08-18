<template>
  <div style="padding:24px 0">
    <div class="config-section">
      <h3>🔐 Acceso por Contraseña</h3>
      <p style="font-size:.85rem;color:#888;margin-bottom:24px">
        La contraseña se renueva automáticamente cada miércoles al mediodía.
      </p>

      <!-- Switch activo -->
      <div class="form-group" style="display:flex;align-items:center;gap:12px">
        <label style="margin:0">Bloqueo activo</label>
        <label class="switch">
          <input type="checkbox" v-model="cfg.activo" @change="guardar">
          <span class="slider"></span>
        </label>
        <span style="font-size:.85rem;color:#aaa">{{ cfg.activo ? '🔒 La Tribu requiere contraseña' : '🔓 Acceso libre' }}</span>
      </div>

      <!-- Contraseña actual -->
      <div style="margin:28px 0 20px;padding:20px;background:#0d0d0d;border:1px solid #222;border-radius:12px">
        <div style="font-size:.8rem;color:#888;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Contraseña actual</div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:2rem;font-weight:800;letter-spacing:6px;color:#c8e6f0;font-family:monospace">{{ cfg.password || '—' }}</span>
          <button class="btn btn-outline" style="padding:6px 14px;font-size:.85rem" @click="copiar" :disabled="!cfg.password">
            {{ copiado ? '✅ Copiado' : '📋 Copiar' }}
          </button>
        </div>
        <div style="font-size:.78rem;color:#555;margin-top:8px">
          Última renovación: {{ cfg.fecha_renovacion ? fmtFecha(cfg.fecha_renovacion) : '—' }}
        </div>
      </div>

      <!-- Renovar manualmente -->
      <div style="margin-bottom:24px">
        <button class="btn btn-outline" @click="renovar" :disabled="renovando" style="border-color:#e55;color:#e55">
          {{ renovando ? 'Renovando...' : '🔄 Renovar contraseña ahora' }}
        </button>
        <div style="font-size:.8rem;color:#888;margin-top:6px">Úsalo ante una filtración o eventualidad.</div>
      </div>

      <!-- Mensaje personalizable -->
      <div class="form-group">
        <label>Mensaje para el usuario</label>
        <input type="text" v-model="cfg.mensaje" placeholder="Ingresa la contraseña para acceder a La Tribu" maxlength="500">
        <div class="field-hint">Se muestra en la pantalla de acceso del landing.</div>
      </div>

      <button class="btn btn-primary" @click="guardar" :disabled="guardando">
        {{ guardando ? 'Guardando...' : '💾 Guardar' }}
      </button>

      <div :class="['msg-box', { success: msg.ok, error: !msg.ok }]" v-if="msg.texto" style="display:block;margin-top:12px">
        {{ msg.texto }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { apiFetch, authHeaders } from '../../utils/api'
import { toast } from '../../utils/toast'

const cfg = reactive({ activo: false, password: '', mensaje: '', fecha_renovacion: null })
const msg = reactive({ texto: '', ok: false })
const guardando = ref(false)
const renovando = ref(false)
const copiado = ref(false)

onMounted(cargar)

async function cargar() {
  try {
    const res = await apiFetch('/tribu-access/config', { headers: authHeaders() })
    const d = await res.json()
    cfg.activo = !!d.activo
    cfg.password = d.password || ''
    cfg.mensaje = d.mensaje || ''
    cfg.fecha_renovacion = d.fecha_renovacion || null
  } catch { mostrarMsg('Error al cargar', false) }
}

async function guardar() {
  guardando.value = true
  try {
    const res = await apiFetch('/tribu-access/config', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ activo: cfg.activo, mensaje: cfg.mensaje })
    })
    const d = await res.json()
    mostrarMsg(res.ok ? d.message : d.error, res.ok)
  } catch { mostrarMsg('Error de conexión', false) }
  finally { guardando.value = false }
}

async function renovar() {
  if (!confirm('¿Renovar la contraseña ahora? La anterior dejará de funcionar.')) return
  renovando.value = true
  try {
    const res = await apiFetch('/tribu-access/renovar', { method: 'POST', headers: authHeaders() })
    const d = await res.json()
    if (res.ok) { cfg.password = d.password; toast('Contraseña renovada', 'success') }
    else mostrarMsg(d.error, false)
  } catch { mostrarMsg('Error de conexión', false) }
  finally { renovando.value = false }
}

async function copiar() {
  try {
    await navigator.clipboard.writeText(cfg.password)
    copiado.value = true
    setTimeout(() => copiado.value = false, 2000)
  } catch { toast('No se pudo copiar', 'error') }
}

function fmtFecha(d) {
  return new Date(d).toLocaleString('es-PE')
}

function mostrarMsg(texto, ok) {
  msg.texto = texto
  msg.ok = ok
}
</script>
