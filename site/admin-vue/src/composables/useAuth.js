import { reactive, computed } from 'vue'
import { API_BASE } from '../utils/api'

const state = reactive({
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  theme: localStorage.getItem('theme') || 'light'
})

export function useAuth() {
  const isSuperAdmin = computed(() => state.user?.rol === 'SUPER_ADMIN')
  const isAdmin = computed(() => {
    const r = state.user?.rol
    return r === 'SUPER_ADMIN' || r === 'ADMIN'
  })

  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    state.theme = dark ? 'dark' : 'light'
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }

  function loadTheme() {
    applyTheme(state.theme === 'dark')
  }

  function toggleTheme() {
    applyTheme(state.theme !== 'dark')
  }

  async function login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    let data
    try {
      data = await res.json()
    } catch {
      throw new Error('Error del servidor. Verifica que el servidor esté activo.')
    }
    if (!res.ok) {
      throw new Error(data.error || 'Usuario o contraseña incorrectos')
    }
    state.token = data.token
    state.user = data.user
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
  }

  function logout() {
    state.token = null
    state.user = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  return {
    state,
    isSuperAdmin,
    isAdmin,
    login,
    logout,
    applyTheme,
    loadTheme,
    toggleTheme
  }
}
