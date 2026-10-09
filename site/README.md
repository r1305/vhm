# VHM — Libro de Reclamaciones Virtual

Backend + frontend para libro de reclamaciones y testimonios. La Tribu (videos, usuarios, suscripciones y pagos Culqi) vive en la app `latribu/` (montada en `/latribu`).

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
├── testimoniosRoutes.js
├── configEmailRoutes.js
├── configPixelRoutes.js
├── configWhatsappRoutes.js
├── ensureSchema.js   ← Auto-migración de tablas
└── mailer.js
lib/
├── siteEnv.js        ← Lectura de variables de entorno
└── mount.js          ← Utilidad de reescritura HTML
public/               ← Frontend estático
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
| Administradores | `admin/usuarios.html` |
| Ajustes | `admin/config.html` |

Shared: `admin/js/api.js`, `auth.js`, `layout.js`, `admin/css/admin.css`

Deploy: sube los archivos editados → Restart en cPanel.

## La Tribu

`/site/latribu` redirige a `https://vhm.com.pe/latribu` (app `latribu/`). Pagos Culqi, suscripciones, usuarios y webhook se gestionan allí.

## Deploy cPanel

Ver `CPANEL.md`. Startup file: `app.js`.

## Variables de entorno

Ver `.env.example`.
