# Variables de entorno: clave vieja → clave nueva

La app unificada (`node app.js`) lee un solo `.env` en la raíz o las variables de la Node.js App de cPanel. Cada app lee solo sus claves con prefijo a través de `lib/env.js`; ninguna escribe en `process.env`. Solo `NODE_ENV`, `PORT` y `TZ` se comparten sin prefijo.

| App | Prefijo | Regla |
|-----|---------|-------|
| crm | `CRM_` | `CLAVE` → `CRM_CLAVE` |
| latribu | `TRIBU_` | `CLAVE` → `TRIBU_CLAVE` |
| luma | `LUMA_` | `CLAVE` → `LUMA_CLAVE` |
| site | `SITE_` | `CLAVE` → `SITE_CLAVE` |

Casos que no siguen la regla general (la clave vieja ya llevaba el prefijo o cambia de nombre):

| App | Clave vieja (`<app>/.env`) | Clave nueva (raíz) |
|-----|----------------------------|--------------------|
| crm | `CRM_ADMIN_INITIAL_PASSWORD` | `CRM_ADMIN_INITIAL_PASSWORD` |
| crm | `CRM_ASSET_VERSION` | `CRM_ASSET_VERSION` |
| crm | `TRIBU_DB_HOST/PORT/USER/PASSWORD/NAME/POOL_MAX` | `CRM_TRIBU_DB_*` |
| latribu | `TRIBU_CRON_ENABLED` | `TRIBU_CRON_ENABLED` |
| latribu | `TRIBU_RENOVACION_CRON_ENABLED` / `_SECRET` | `TRIBU_RENOVACION_CRON_ENABLED` / `_SECRET` |
| latribu | `TRIBU_GRACIA_DIAS`, `TRIBU_TRIAL_DIAS` | iguales |
| latribu | `SITE_URL` (URL pública con `/latribu`) | `TRIBU_SITE_URL` |
| luma | `LUMA_BOOTSTRAP_PASSWORD` | `LUMA_BOOTSTRAP_PASSWORD` |
| site | `SITE_URL` (origen del sitio) | `SITE_URL` |
| site | `CRM_PUBLIC_URL` | `SITE_CRM_PUBLIC_URL` |
| todas | `NODE_ENV`, `PORT`, `TZ` | iguales, sin prefijo |
| todas | `APP_MOUNT_PATH` | no se usa en modo unificado (el montaje es fijo: `/crm`, `/latribu`, `/luma`, `/`) |
| todas | `PASSENGER_MAX_POOL_SIZE` | no se usa en modo unificado (fijo en 1) |
| site, latribu | `APP_SITE_PREFIX` | eliminada: el prefijo lo pone `lib/env.js` |

Ejemplos de la regla general: `DB_HOST` de crm → `CRM_DB_HOST`; `JWT_SECRET` de luma → `LUMA_JWT_SECRET`; `SMTP_PASS` de latribu → `TRIBU_SMTP_PASS`; `OPENWA_URL` de crm → `CRM_OPENWA_URL`.

## Orden de lectura

- Modo unificado: `process.env.<PREFIJO>CLAVE` → `.env` raíz → `.env` propio de la app (solo para desarrollo local; acepta `CLAVE` o `<PREFIJO>CLAVE`).
- Apps sueltas (`node <app>/app.js`, tests): `process.env.<PREFIJO>CLAVE` → `process.env.CLAVE`. El shell de cada app sigue cargando su propio `.env` con `dotenv`.
- CRM: lo que `loadConfigFromDB` y `/api/config` leen de la tabla `configuracion` (SMTP_*, OPENWA_*, SMS_GATEWAY_*) queda en un objeto del CRM (`env.set`) y prevalece sobre el entorno.

## Fuera del cargador

Scripts manuales (`crm/scripts/*`, `crm/reset-admin.js`, `latribu/scripts/*`, `site/migrate-db.js`, `site/flush-hosts.js`, `site/scripts/*`) siguen con `dotenv` y claves sin prefijo del `.env` de su app.
