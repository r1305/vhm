import { createRouter, createWebHashHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import AdminLayout from '../views/AdminLayout.vue'
import ReclamosView from '../views/ReclamosView.vue'
import TestimoniosView from '../views/TestimoniosView.vue'
import VideosView from '../views/VideosView.vue'
import UsuariosView from '../views/UsuariosView.vue'
import ConfigView from '../views/ConfigView.vue'

const routes = [
  { path: '/login', name: 'login', component: LoginView },
  {
    path: '/',
    component: AdminLayout,
    redirect: '/reclamos',
    children: [
      { path: 'reclamos', name: 'reclamos', component: ReclamosView, meta: { roles: ['ADMIN', 'SUPER_ADMIN'] } },
      { path: 'testimonios', name: 'testimonios', component: TestimoniosView, meta: { roles: ['ADMIN', 'SUPER_ADMIN'] } },
      { path: 'videos', name: 'videos', component: VideosView, meta: { roles: ['ADMIN', 'SUPER_ADMIN'] } },
      { path: 'usuarios', name: 'usuarios', component: UsuariosView, meta: { roles: ['ADMIN', 'SUPER_ADMIN'] } },
      { path: 'config', name: 'config', component: ConfigView, meta: { roles: ['SUPER_ADMIN'] } }
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token')
  if (to.name !== 'login' && !token) {
    next('/login')
  } else if (to.name === 'login' && token) {
    next('/reclamos')
  } else {
    next()
  }
})

export default router
