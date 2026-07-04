<template>
  <div>
    <div class="sidebar-overlay" :class="{ show: sidebarOpen }" @click="sidebarOpen = false"></div>
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-brand">
        <img :src="'logo_vhm.jpeg'" alt="VHM">
        <div class="brand-text">
          <div class="brand-title">VHM Admin</div>
          <div class="brand-sub">Panel de gestión</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <div class="nav-label">Principal</div>
        <button class="nav-item" :class="{ active: $route.path === '/reclamos' }" @click="navigate('/reclamos')">
          <span class="nav-icon">📋</span> Reclamos
        </button>
        <button v-if="auth.isAdmin" class="nav-item" :class="{ active: $route.path === '/testimonios' }" @click="navigate('/testimonios')">
          <span class="nav-icon">⭐</span> Testimonios
        </button>
        <button class="nav-item" :class="{ active: $route.path === '/videos' }" @click="navigate('/videos')">
          <span class="nav-icon">🎬</span> La Tribu
        </button>
        <div class="nav-label">Configuración</div>
        <button class="nav-item" :class="{ active: $route.path === '/usuarios' }" @click="navigate('/usuarios')">
          <span class="nav-icon">👥</span> Usuarios
        </button>
        <button v-if="auth.isAdmin" class="nav-item" :class="{ active: $route.path === '/config' }" @click="navigate('/config')">
          <span class="nav-icon">⚙️</span> Ajustes
        </button>
      </nav>
      <div class="sidebar-footer">
        <div class="user-card">
          <div class="user-avatar">{{ userInitial }}</div>
          <div>
            <div class="user-name">{{ userName }}</div>
            <div class="user-rol">{{ userRol }}</div>
          </div>
        </div>
        <button class="btn-theme" @click="auth.toggleTheme()" style="width:100%;padding:10px;margin-bottom:6px;border:1px solid var(--border-strong);background:var(--bg-card);border-radius:10px;font-size:.85rem;color:var(--text-secondary);font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
          <span>{{ auth.state.theme === 'dark' ? '☀️' : '🌙' }}</span>
          <span>{{ auth.state.theme === 'dark' ? 'Modo claro' : 'Modo oscuro' }}</span>
        </button>
        <button class="btn-logout" @click="doLogout">
          <span>🚪</span> Cerrar sesión
        </button>
      </div>
    </aside>
    <div class="main-wrapper">
      <div class="topbar">
        <button class="hamburger" @click="sidebarOpen = !sidebarOpen">☰</button>
        <div class="page-title">{{ pageTitle }}</div>
        <div class="topbar-actions"></div>
      </div>
      <div class="content">
        <router-view />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const sidebarOpen = ref(false)

const PAGE_TITLES = {
  reclamos: '📋 Reclamos',
  testimonios: '⭐ Testimonios',
  videos: '🎬 La Tribu',
  usuarios: '👥 Usuarios',
  config: '⚙️ Configuración'
}

const pageTitle = computed(() => {
  const name = route.name || 'reclamos'
  return PAGE_TITLES[name] || 'Panel'
})

const userName = computed(() => {
  const u = auth.state.user
  return u?.nombre || u?.username || 'Usuario'
})

const userRol = computed(() => {
  const u = auth.state.user
  return u?.rol === 'SUPER_ADMIN' ? 'Super Admin' : 'Administrador'
})

const userInitial = computed(() => {
  return (auth.state.user?.nombre || auth.state.user?.username || 'A').charAt(0).toUpperCase()
})

function navigate(path) {
  sidebarOpen.value = false
  router.push(path)
}

function doLogout() {
  auth.logout()
  router.push('/login')
}
</script>
