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
   - `admin-vue/node_modules/` si compilas admin en local

2. En **Setup Node.js App** → **Run NPM Install**

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

## La Tribu + Mercado Pago

| Recurso | URL |
|---------|-----|
| La Tribu | `/site/latribu` |
| Webhook MP | `https://vhm.com.pe/site/api/tribu-pagos/webhook` |
| Admin | `/site/admin` |

En el panel admin → **Configuración → Mercado Pago**: Public Key, Access Token y modo (sandbox/producción).

Webhook en [Mercado Pago Developers](https://www.mercadopago.com.pe/developers/panel): evento **Orders**, URL del webhook arriba.

## Admin Vue (opcional)

Si cambiaste el panel admin:

```bash
cd admin-vue && npm install && npm run build
```

Copia el build a `public/admin/`.

## Health check

`https://vhm.com.pe/site/health` → `{ "ok": true }`
