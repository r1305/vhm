<template>
  <div>
    <div class="section-header">
      <div>
        <h2>🎬 La Tribu — Camino Interior</h2>
        <p>Videos, categorías, eventos y textos de la sección</p>
      </div>
    </div>
    <div class="sub-tabs">
      <button :class="{ active: tabActivo === 'resumen' }" @click="tabActivo = 'resumen'">📊 Resumen</button>
      <button :class="{ active: tabActivo === 'videos' }" @click="tabActivo = 'videos'">🎬 Videos</button>
      <button :class="{ active: tabActivo === 'categorias' }" @click="tabActivo = 'categorias'">🗂️ Categorías</button>
      <button :class="{ active: tabActivo === 'landing' }" @click="tabActivo = 'landing'">📝 Textos</button>
      <button :class="{ active: tabActivo === 'eventos' }" @click="tabActivo = 'eventos'">📅 Eventos</button>
      <button :class="{ active: tabActivo === 'acceso' }" @click="tabActivo = 'acceso'">🔐 Acceso</button>
    </div>
    <ResumenTab v-show="tabActivo === 'resumen'" />
    <VideosTab v-show="tabActivo === 'videos'" />
    <CategoriasTab v-show="tabActivo === 'categorias'" />
    <LandingTab v-show="tabActivo === 'landing'" />
    <EventosTab v-show="tabActivo === 'eventos'" />
    <AccesoTab v-show="tabActivo === 'acceso'" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import ResumenTab from './videos/ResumenTab.vue'
import VideosTab from './videos/VideosTab.vue'
import CategoriasTab from './videos/CategoriasTab.vue'
import LandingTab from './videos/LandingTab.vue'
import EventosTab from './videos/EventosTab.vue'

import AccesoTab from './videos/AccesoTab.vue'

const tabActivo = ref('videos')
</script>
