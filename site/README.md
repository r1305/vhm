# VHM — Libro de Reclamaciones Virtual

Backend + frontend para libro de reclamaciones, videos/masterclass ("La Tribu"), testimonios y chat IA "Clara".

## Requisitos

- Node.js >= 20
- MySQL

## Instalación

```bash
npm install
cp .env.example .env
# Editar .env con credenciales de DB y JWT_SECRET
npm start
```

El servidor arranca en `http://localhost:3000/site/`.

La app se monta bajo `/site` (configurable via `APP_MOUNT_PATH` en `.env`).

## Estructura

```
src/
├── index.js          ← App principal Express
├── db.js             ← Pool MySQL
├── auth.js           ← Middleware JWT
├── routes.js         ← Reclamos
├── authRoutes.js     ← Login / registro
├── usuariosRoutes.js
├── videosRoutes.js
├── testimoniosRoutes.js
├── claraRoutes.js    ← Chat IA
├── eventosRoutes.js
├── configEmailRoutes.js
├── configPixelRoutes.js
├── configWhatsappRoutes.js
├── ensureSchema.js   ← Auto-migración de tablas
├── tribuAuthRoutes.js    ← Login/registro La Tribu
├── tribuPagosRoutes.js   ← Culqi (cargos + tarjetas guardadas)
├── tribuCulqi.js         ← Cliente API Culqi
├── tribuAccessRoutes.js  ← Gate contraseña landing
├── tribuUsersRoutes.js   ← Admin usuarios La Tribu
├── suscripcionesRoutes.js
├── configCulqiRoutes.js
└── mailer.js
lib/
├── siteEnv.js        ← Lectura de variables de entorno
└── mount.js          ← Utilidad de reescritura HTML
public/               ← Frontend estático (videos.html = La Tribu en /latribu)
public/admin/         ← Panel admin HTML + JS (sin build, sin Vue)
app.js                ← Entry point (Passenger / standalone)
```

## Panel admin

HTML + JavaScript vanilla en `public/admin/` — **sin compilación**.

| Página | Archivo |
|--------|---------|
| Login | `admin/login.html` |
| Reclamos | `admin/reclamos.html` |
| Testimonios | `admin/testimonios.html` |
| La Tribu | `admin/videos.html` |
| Usuarios Tribu | `admin/tribu-users.html` |
| Administradores | `admin/usuarios.html` |
| Ajustes | `admin/config.html` |

Shared: `admin/js/api.js`, `auth.js`, `layout.js`, `admin/css/admin.css`

Deploy: sube los archivos editados → Restart en cPanel.

## La Tribu

- Página: `public/videos.html` servida en `/site/latribu`
- Pagos: Checkout API vía Orders API (`/api/tribu-pagos/procesar-pago`)
- Variables extra: `SITE_URL`, `CULQI_WEBHOOK_SECRET`, `TRIBU_RENOVACION_CRON_SECRET` (ver `.env.example`)

## Deploy cPanel

Ver `CPANEL.md`. Startup file: `app.js`.

## Variables de entorno

Ver `.env.example`.
