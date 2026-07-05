<template>
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
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiFetch, authHeaders } from '../../utils/api'
import { toast } from '../../utils/toast'

const landingIntro = ref('')
const landingPacto = ref('')

onMounted(cargarLanding)

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
</script>
