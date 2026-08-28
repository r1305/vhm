# Deploy en cPanel (git pull + restart)

## Estructura del repo

```
vhm/                  ← RAÍZ git (aquí está .git)
  site/               ← App Node (Application root en cPanel)
    app.js            ← Startup file
    public/admin/     ← Panel admin HTML
    src/
```

**Importante:** `git pull` se ejecuta en la carpeta **padre** de `site/`, no dentro de `site/`.

## Pasos

### 1. Terminal SSH en cPanel

**Un solo comando (site + crm + openwa — pull + npm + limpiar workers + reinicio):**

```bash
cd ~/public_html && bash site/deploy.sh --restart
```

(Ajusta `~/public_html` si tu repo está en otra ruta; debe ser la carpeta **padre** de `site/`, `crm/` y `openwa/`.)

Solo pull + limpieza, sin reiniciar:

```bash
cd ~/public_html && bash site/deploy.sh
```

O manualmente:

```bash
cd ~/public_html
git fetch origin main
git reset --hard origin/main
cd site
npm install --omit=dev
bash scripts/cpanel-clean-workers.sh -f
bash scripts/cpanel-restart-apps.sh
```

### 2. cPanel → Setup Node.js App (solo si no usaste `--restart`)

Si no tienes `cloudlinux-selector` en SSH: **STOP** → `bash site/scripts/cpanel-clean-workers.sh -f` → **START** una vez.

### 3. Verificar (debe responder JSON, no "Cannot GET")

| URL | Esperado |
|-----|----------|
| `/site/api/deploy-info` | `"version": "...html-admin-v3..."`, `"tribuCronEnabled": false` |
| `/site/api/pixel-config` | `"_deployVersion":"html-admin-v3"` |
| `/site/admin/login.html` | Pantalla de login con estilos |
| `/site/admin/js/api.js` | Código JavaScript (texto), **no** HTML |

### 4. Hard refresh en el navegador

`Ctrl+Shift+R` en Windows.

## Si git pull falla

```bash
git checkout -- site/package.json
git reset --hard origin/main
```

## Panel admin

Sin Vue. Sin build. Archivos en `site/public/admin/`.

- Login: `/site/admin/login.html`
- Tras login: `/site/admin/reclamos.html`

## Procesos en cPanel (LVE)

Si ves el uso de procesos subir (ej. 90/100):

1. **No uses PM2** junto con la app Node de cPanel (solo una forma de correr Node).
2. **Actualiza el código** (`bash site/deploy.sh`) — versiones viejas ejecutaban `npm build` en cada restart.
3. En `.env` del servidor:
   ```env
   TRIBU_CRON_ENABLED=0
   PASSENGER_MAX_POOL_SIZE=2
   DB_POOL_MAX=3
   ```
4. **Stop** la app en cPanel, luego **Start** una sola vez (no Restart en bucle).
5. Limpieza automática (recomendado en cada deploy):

   ```bash
   bash site/scripts/cpanel-clean-workers.sh -f
   ```

   O incluida en `bash site/deploy.sh --restart`.

6. Si quedan workers viejos manualmente:

   ```bash
   bash site/scripts/cpanel-clean-workers.sh -f -v
   ps aux | grep lsnode | grep -v grep   # debe quedar vacío o solo los activos
   ```

7. En cPanel → **Process Manager** / terminal: mata procesos `npm` huérfanos de builds viejos:
   ```bash
   pkill -f "npm run build" 2>/dev/null
   pkill -f "vite build" 2>/dev/null
   ```

Verifica: `/site/api/deploy-info` debe mostrar `"version": "...html-admin-v3..."` y `"tribuCronEnabled": false`.
