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

```bash
cd ~/ruta/al/repo          # carpeta que CONTIENE site/
bash site/deploy.sh
```

O manualmente:

```bash
cd ~/ruta/al/repo
git fetch origin main
git reset --hard origin/main
cd site
npm install --omit=dev
```

### 2. cPanel → Setup Node.js App → **Restart**

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
5. Si quedan workers viejos (`lsnode`), mátalos antes de Start:
   ```bash
   pkill -f "lsnode:/home/TU_USUARIO/public_html/site/"
   ps aux | grep lsnode | grep -v grep   # debe quedar vacío
   ```
6. En cPanel → **Process Manager** / terminal: mata procesos `npm` huérfanos de builds viejos:
   ```bash
   pkill -f "npm run build" 2>/dev/null
   pkill -f "vite build" 2>/dev/null
   ```

Verifica: `/site/api/deploy-info` debe mostrar `"version": "...html-admin-v3..."` y `"tribuCronEnabled": false`.
