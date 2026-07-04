<template>
  <div class="login-container">
    <div class="login-box">
      <img :src="logoSrc" alt="VHM" class="logo">
      <h2>Panel de Administración</h2>
      <p>Ingresa para gestionar tu sitio VHM</p>
      <div class="error" :style="{ display: error ? 'block' : 'none' }">{{ error }}</div>
      <input type="text" v-model="username" placeholder="Usuario" autocomplete="username" @keypress.enter="doLogin">
      <input type="password" v-model="password" placeholder="Contraseña" autocomplete="current-password" @keypress.enter="doLogin">
      <button @click="doLogin" :disabled="loading">
        <span v-show="loading" class="spinner" style="display:inline-block;width:18px;height:18px;border:2.5px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;"></span>
        <span>{{ loading ? 'Ingresando...' : 'Ingresar' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
@keyframes spin { to { transform: rotate(360deg); } }
</style>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { toast } from '../utils/toast'

const router = useRouter()
const { login } = useAuth()
const logoSrc = 'logo_vhm.jpeg'

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function doLogin() {
  if (!username.value || !password.value) {
    error.value = 'Ingresa usuario y contraseña'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await login(username.value, password.value)
    router.push('/reclamos')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>
