# cPanel — VHM Site

## Configuración Node.js

- **Startup file:** `app.js`
- **Application root:** carpeta `site` del dominio (ej. `public_html/site`)
- **URL:** `https://vhm.com.pe/site/` (ajustar `APP_MOUNT_PATH=/site` en `.env`)
- Una sola app Node por dominio; no usar PM2 cluster en hosting compartido

## Subir cambios

1. Sube **todo el proyecto** excepto:
   - `node_modules/` (instalar en servidor)
   - `.env` (editar solo en cPanel, nunca subir desde git)

2. En **Setup Node.js App** → **Run NPM Install** (solo si cambiaste dependencias)

3. Edita `.env` en el servidor (copia de `.env.example`):

```env
NODE_ENV=production
APP_MOUNT_PATH=/site
SITE_URL=https://vhm.com.pe/site
CORS_ORIGIN=https://vhm.com.pe
JWT_SECRET=<secret fuerte>
```

4. **Restart** la aplicación Node

5. La primera vez que arranca, `ensureSchema.js` crea/actualiza tablas del sitio (accesos, columnas de testimonios y reclamos)

### Flujo habitual (cualquier cambio)

1. Sube archivos (FTP, git pull, etc.) — **no hay build de frontend**
2. **Restart** en cPanel
3. Hard refresh en el navegador (`Ctrl+Shift+R`)

### Verificar deploy

Abre estas URLs (deben responder **JSON** o **texto**, nunca "Cannot GET"):

| URL | Esperado |
|-----|----------|
| `/site/api/deploy-info` | JSON con `version`, `adminJs: true` |
| `/site/api/pixel-config` | `"_deployVersion":"html-admin-v2"` |
| `/site/DEPLOY_VERSION.txt` | `deploy-version=html-admin-v2` |
| `/site/admin/js/api.js` | Código JavaScript (no HTML) |
| `/site/admin/login.html` | Pantalla de login con estilos |

### Deploy con git (Terminal SSH)

**Comando único (site + crm + openwa — pull + npm + limpiar workers + reinicio):**

```bash
cd ~/public_html && bash site/deploy.sh --restart
```

Solo actualizar código y limpiar workers (sin reiniciar):

```bash
cd ~/public_html && bash site/deploy.sh
```

Solo limpiar workers huérfanos (site, crm, openwa):

```bash
bash site/scripts/cpanel-clean-workers.sh -f
```

Solo reiniciar las tres apps:

```bash
bash site/scripts/cpanel-restart-apps.sh
```

Reiniciar una sola app:

```bash
bash site/scripts/cpanel-restart-apps.sh site
bash site/scripts/cpanel-restart-apps.sh crm
bash site/scripts/cpanel-restart-apps.sh openwa
```

Si `cloudlinux-selector` no existe en tu servidor: **STOP** cada app → `bash site/scripts/cpanel-clean-workers.sh -f` → **START**.

**Video La Tribu (`media/tribu-hero.mp4`):** el repo usa Git LFS. cPanel **no trae `git lfs`**. Tras `git pull`, ejecuta:

```bash
cd ~/public_html          # raíz del repo (carpeta con media/ y site/)
git pull
node site/scripts/fetch-hero-media.js
```

Tarda varios minutos (~1.3 GB). Alternativa: sube `media/tribu-hero.mp4` por **FTP / Administrador de archivos** desde tu PC (debe pesar ~1.3 GB, no 135 bytes).

Verifica: `https://vhm.com.pe/site/api/deploy-info` → `"tribuHeroMedia":{"ok":true,"sizeBytes":1357577878}`.

Luego **Restart** en cPanel.

Ver guía completa: `site/DEPLOY.md`

## Panel admin (HTML, sin Vue)

| Sección | URL |
|---------|-----|
| Login | `/site/admin/login.html` |
| Reclamos | `/site/admin/reclamos.html` |
| Ajustes (Super Admin) | `/site/admin/config.html` |

Archivos en `public/admin/` — editas HTML/JS/CSS y subes directo.

## La Tribu + Culqi

La Tribu, sus suscripciones y los pagos Culqi viven en la app `latribu/` (`/site/latribu` solo redirige a `https://vhm.com.pe/latribu`).

| Recurso | URL |
|---------|-----|
| La Tribu | `https://vhm.com.pe/latribu` |
| Webhook Culqi | `https://vhm.com.pe/latribu/api/tribu-pagos/webhook` |
| Cron renovaciones | `https://vhm.com.pe/latribu/api/tribu-pagos/cron-renovaciones` con cabecera `X-Cron-Token` (ver `latribu/CPANEL.md`) |

El webhook de Culqi debe apuntar a **latribu**; `/site/api/tribu-pagos/*` ya no existe. Las llaves Culqi se configuran en el admin de La Tribu (`/latribu/admin/config.html`).

## Health check

`https://vhm.com.pe/site/health` → `{ "ok": true, "admin": "html" }`

## Archivos que no debe servir el servidor web

Las apps viven dentro de `public_html`, así que LiteSpeed puede servir directamente
cualquier archivo real (código, `package.json`, `.env`, `stderr.log`, …) sin pasar por Node.

- El repo incluye `.htaccess` con `Require all denied` (y `Deny from all` para Apache 2.2)
  en las carpetas de código: `site/{src,lib,scripts}`, `crm/{lib,routes,scripts,views}`,
  `luma/src` y `latribu/{src,lib,scripts,test}`. Nunca en `public/`.
- Lo que está en la raíz de cada app (`node_modules/`, `package.json`, `.env`, `stderr.log`,
  scripts sueltos) solo se puede proteger desde el `.htaccess` raíz de cada app,
  que gestiona cPanel/Passenger. Añade el bloque **fuera** de
  `# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION BEGIN/END`.

**Nunca denegar el startup file (app.js) ni la carpeta de la app: provoca 403 en todo el sitio.**
En las 4 apps (site, crm, luma, latribu) el *Application startup file* de LiteSpeed/lsnode
(Passenger) es `app.js` en la raíz. Si un `FilesMatch` o un `Require all denied` lo alcanza,
todas las URL de la app devuelven 403 (ya ocurrió en `/latribu`). Por eso ningún bloque
incluye `app\.js` ni `index\.js`.

`public_html/site/.htaccess`:

```apache
RedirectMatch 404 ^/site/(node_modules|src|lib|scripts)(/|$)
<FilesMatch "^(package(-lock)?\.json|.*\.log|.*\.md|\.env.*|migrate-db\.js|flush-hosts\.js|.*\.sql|.*\.sh)$">
Require all denied
</FilesMatch>
```

`migrate-db.js`, `flush-hosts.js`, `config_pixel.sql` y `deploy.sh` son scripts manuales de
la raíz: Passenger no los carga y `public/` no tiene archivos con esos nombres o extensiones.

`public_html/crm/.htaccess` (el CRM sirve `/crm/app.js` desde `public/`, así que aquí
**no** se bloquean los `.js` sueltos):

```apache
RedirectMatch 404 ^/crm/(node_modules|lib|routes|scripts|views)(/|$)
<FilesMatch "^(package(-lock)?\.json|.*\.log|.*\.md|\.env.*)$">
Require all denied
</FilesMatch>
```

`public_html/luma/.htaccess`:

```apache
RedirectMatch 404 ^/luma/(node_modules|src)(/|$)
<FilesMatch "^(package(-lock)?\.json|.*\.log|.*\.md|\.env.*)$">
Require all denied
</FilesMatch>
```

Comprobado en el código: ninguna ruta de Express ni carpeta de `public/` empieza por los
nombres del `RedirectMatch` (site: `/api/*`, `/admin/*`, `/media`, `/consulta`, …; CRM:
`/api/*`, `/agenda`, `/pacientes`, …, y `public/` no tiene `lib`, `routes`, `scripts` ni
`views`; luma: `/`, `/admin`, `/api`, `/health`). El `/test` de site es
`/api/config-email/test`, no `/site/test`. Cada `app.js` carga `./src/index`, `./lib/...` o
`./routes/...` con `require` (sistema de archivos, no HTTP), así que los `.htaccess` de
esas carpetas no afectan al arranque; ninguna app tiene el startup file dentro de ellas.

Verificación obligatoria tras pegar cada bloque (`<app>` = `site`, `crm`, `luma`):

- `/<app>/` y `/<app>/health` responden 200/302 (en el CRM también `/crm/login`).
- `/<app>/package.json` da 403/404.
- **Si `/<app>/` da 403, quitar el bloque inmediatamente** y revisar que nada del
  `.htaccess` coincida con `app.js` ni con la carpeta de la app.

El de La Tribu está en `latribu/CPANEL.md`.

- Riesgo pendiente en el CRM: `crm/app.js`, `crm/schema.js`, `crm/cron-wsp.js`,
  `crm/reset-admin.js` y `crm/generate-icons.js` son archivos reales en la raíz. Si
  LiteSpeed sirve los estáticos antes que Passenger, `/crm/app.js` devuelve el código del
  servidor en lugar del `public/app.js`. Comprobarlo abriendo `https://vhm.com.pe/crm/app.js`:
  si aparece `require('express')`, la solución definitiva es mover la app fuera de
  `public_html`.
- Recomendado: mover las apps Node fuera de `public_html` (p. ej. `~/apps/<app>`) y dejar
  que cPanel solo publique la URL vía Passenger.
