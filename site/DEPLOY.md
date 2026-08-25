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
| `/site/api/deploy-info` | `"version": "deploy-version=html-admin-v2..."` |
| `/site/api/pixel-config` | `"_deployVersion":"html-admin-v2"` |
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
