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
MP_SANDBOX_PAYER_EMAIL=test_user_XXXXX@testuser.com   # solo sandbox
```

4. **Restart** la aplicación Node

5. La primera vez que arranca, `ensureSchema.js` crea/actualiza tablas (incl. La Tribu y Mercado Pago)

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

```bash
cd ~/ruta/al/repo    # carpeta PADRE de site/ (donde está .git)
bash site/deploy.sh
```

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

## La Tribu + Mercado Pago

| Recurso | URL |
|---------|-----|
| La Tribu | `/site/latribu` |
| Webhook MP | `https://vhm.com.pe/site/api/tribu-pagos/webhook` |

En el panel admin → **Ajustes → Mercado Pago**: Public Key, Access Token y modo (sandbox/producción).

## Health check

`https://vhm.com.pe/site/health` → `{ "ok": true, "admin": "html" }`
