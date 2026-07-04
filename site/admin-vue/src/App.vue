<template>
  <div id="app-root">
    <div id="toast-container">
      <div v-for="t in toasts" :key="t.id"
        :class="['toast', 'toast-' + t.type, { removing: t.removing }]">
        <span class="toast-icon">{{ t.icon }}</span>
        <span class="toast-msg">{{ t.message }}</span>
        <button class="toast-close" @click="dismissToast(t.id)">✕</button>
      </div>
    </div>
    <router-view />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { onToast } from './utils/toast'
import { useAuth } from './composables/useAuth'

const { loadTheme } = useAuth()

const toasts = ref([])
let nextId = 0

onMounted(() => {
  loadTheme()
  const unsub = onToast(({ message, type, duration }) => {
    const id = ++nextId
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'
    toasts.value.push({ id, message, type, icon, removing: false })
    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration)
    }
  })
  onUnmounted(unsub)
})

function dismissToast(id) {
  const t = toasts.value.find(t => t.id === id)
  if (t) t.removing = true
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 300)
}
</script>
