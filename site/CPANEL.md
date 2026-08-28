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
CULQI_WEBHOOK_SECRET=   # opcional, firma webhook Culqi
TRIBU_RENOVACION_CRON_SECRET=<generar con node -e "...">
```

4. **Restart** la aplicación Node

5. La primera vez que arranca, `ensureSchema.js` crea/actualiza tablas (incl. La Tribu y Culqi)

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

**Comando recomendado (site + crm + openwa — pull + npm + limpiar workers + reinicio):**

```bash
cd ~/public_html && bash deploy.sh --restart
```

Equivalente:

```bash
cd ~/public_html && bash site/deploy.sh --restart
```

Solo actualizar código y limpiar workers (sin reiniciar):

```bash
cd ~/public_html && bash deploy.sh
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
| La Tribu | `/site/admin/videos.html` |
| Usuarios Tribu | `/site/admin/tribu-users.html` |
| Ajustes (Super Admin) | `/site/admin/config.html` |

Archivos en `public/admin/` — editas HTML/JS/CSS y subes directo.

## La Tribu + Culqi

| Recurso | URL |
|---------|-----|
| La Tribu | `/site/latribu` |
| Webhook Culqi | `https://vhm.com.pe/site/api/tribu-pagos/webhook` |
| Cron renovaciones | `https://vhm.com.pe/site/api/tribu-pagos/cron-renovaciones?token=...` |

En el panel admin → **Ajustes → Culqi**: Public Key, Secret Key y modo (sandbox/producción).

## Health check

`https://vhm.com.pe/site/health` → `{ "ok": true, "admin": "html" }`
