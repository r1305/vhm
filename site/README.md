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
├── tribuPagosRoutes.js   ← Mercado Pago (Orders API)
├── tribuAccessRoutes.js  ← Gate contraseña landing
├── tribuUsersRoutes.js   ← Admin usuarios La Tribu
├── suscripcionesRoutes.js
├── configMercadoPagoRoutes.js
└── mailer.js
lib/
├── siteEnv.js        ← Lectura de variables de entorno
└── mount.js          ← Utilidad de reescritura HTML
public/               ← Frontend estático (videos.html = La Tribu en /latribu)
app.js                ← Entry point (Passenger / standalone)
```

## La Tribu

- Página: `public/videos.html` servida en `/site/latribu`
- Pagos: Checkout API vía Orders API (`/api/tribu-pagos/procesar-pago`)
- Variables extra: `SITE_URL`, `MP_SANDBOX_PAYER_EMAIL`, `MP_WEBHOOK_SECRET` (ver `.env.example`)

## Deploy cPanel

Ver `CPANEL.md`. Startup file: `app.js`.

## Variables de entorno

Ver `.env.example`.
