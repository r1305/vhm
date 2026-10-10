# La Tribu en cPanel

App Node `latribu/` (Application Manager / Passenger, `node app.js`, montada en `/latribu`).
Zona horaria: America/Lima (ver `vhm/AGENTS.md`).

## Cron Job de renovaciones (cPanel → Cron Jobs)

Las renovaciones automáticas se disparan desde un Cron Job de cPanel cada hora.
El token va **solo** en la cabecera `X-Cron-Token` (ya no se acepta `?token=` en la URL,
para que no quede en logs de acceso ni en el historial).

- Frecuencia: `0 * * * *` (cada hora, minuto 0)
- Comando:

```sh
curl -fsS -m 120 -H "X-Cron-Token: <TRIBU_RENOVACION_CRON_SECRET>" https://vhm.com.pe/latribu/api/tribu-pagos/cron-renovaciones > /dev/null
```

- `<TRIBU_RENOVACION_CRON_SECRET>` es el mismo valor que en el `.env` de latribu.
- Respuestas: `200` con el resumen, `401` token inválido, `429` ya hay otra ejecución
  (GET_LOCK `tribu_renovaciones`), `500` error.
- El cron dentro del proceso (`TRIBU_RENOVACION_CRON_ENABLED=1`) queda como respaldo:
  ambos comparten el mismo GET_LOCK y el claim por suscripción, así que no se duplican cobros.

Cada ejecución:
1. Cobra las suscripciones con `auto_renovacion=1` vencidas (`fecha_fin <= hoy`), con
   `renovacion_intentos < 4` y sin `pendiente_conciliar`.
2. Antes de cobrar, si hay una transacción aprobada `tribu-renew-<id>-%` en las últimas
   48 h, no vuelve a cobrar (la aplica o marca la suscripción para conciliación).
3. Clave de idempotencia Culqi por periodo e intento: `ren_<subId>_<fecha_fin>_<intento>`.
   Si Culqi no responde (timeout 20 s), el resultado se trata como desconocido: no cuenta
   como intento fallido y se reintenta en 1 h con la **misma** clave, de modo que Culqi
   devuelve el cargo original si llegó a crearse.
4. Cierra (`activo=0`) las suscripciones vencidas sin autorrenovación, sin tarjeta, con
   4 intentos agotados o fuera del periodo de gracia (`TRIBU_GRACIA_DIAS`, por defecto 3).

## Conciliación manual

Si un cobro se aprobó en Culqi pero la BD no pudo aplicarlo, la suscripción queda con
`pendiente_conciliar=1` (el cron no la vuelve a cobrar ni la cierra) y el log muestra una
línea `[CONCILIAR]`. Para revisar:

```sql
SET time_zone = '-05:00';
SELECT id, tribu_user_id, fecha_fin, culqi_charge_id FROM tribu_suscripciones WHERE pendiente_conciliar = 1;
SELECT culqi_charge_id, status, external_reference, created_at FROM tribu_culqi_transactions
 WHERE status = 'approved' AND tribu_suscripcion_id IS NULL ORDER BY created_at DESC;
```

Tras aplicar el periodo a mano, poner `pendiente_conciliar = 0`.

## Webhook de Culqi

URL: `https://vhm.com.pe/latribu/api/tribu-pagos/webhook` (eventos de cargo,
p. ej. `charge.creation.succeeded`).

- En producción, sin `CULQI_WEBHOOK_SECRET` el webhook responde `503` (fail-closed).
- `CULQI_WEBHOOK_AUTH` elige cómo se verifica: `hmac` (por defecto, cabecera
  `x-culqi-signature` = HMAC-SHA256 hex del cuerpo), `basic` (credenciales
  `usuario:clave` en la URL del webhook, p. ej. `https://usuario:clave@vhm.com.pe/...`)
  o `token` (cabecera `x-webhook-token`). Si el panel de Culqi no firma los eventos,
  usar `basic`.
- Sea cual sea el modo, el cargo **siempre** se consulta en la API de Culqi y se valida
  monto (= precio del plan × 100), moneda `PEN`, referencia `tribu-…` y estado aprobado
  antes de activar nada.

## Correo (SMTP)

Recuperación de contraseña y verificación de email usan **la misma configuración SMTP que
site**: la tabla `config_email` (fila `id = 1`) de la BD `ssfdgwtm_vhm`. Se edita desde el
panel de site; latribu no escribe en ella.

- Se lee con el pool normal de latribu (`src/db.js`, usuario `DB_USER`) usando el nombre
  calificado `` `ssfdgwtm_vhm`.config_email ``; no se abre ninguna conexión extra.
- `EMAIL_CONFIG_DB_NAME` (opcional, por defecto `ssfdgwtm_vhm`) indica la BD. Solo admite
  `[A-Za-z0-9_]`; un valor inválido se trata como fallo de lectura.
- La configuración se guarda en memoria 10 minutos y se refresca al enviar o al comprobar
  si hay correo (sin timers). Un cambio en `config_email` tarda como máximo 10 min en
  aplicarse (o reiniciar la app). Si cambian host, puerto, usuario o contraseña, el
  transporter se recrea y el anterior se cierra.
- Si la lectura falla: se mantiene la última configuración leída (reintento cada 1 min); si
  nunca se leyó, se usan las variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASS`, `SMTP_FROM` como respaldo, con un aviso en el log (solo el código de error).
- Sin ninguna de las dos no se envía nada (aviso en el log), el registro no exige
  verificación y la recuperación responde igual pero sin correo.
- `SITE_URL` debe ser la URL pública (`https://vhm.com.pe/latribu`) para construir los enlaces.

### Permiso MySQL (ya concedido)

El usuario de latribu (`ssfdgwtm_tribu`) tiene **solo SELECT** sobre la BD `ssfdgwtm_vhm`
(un UPDATE responde `ER_TABLEACCESS_DENIED_ERROR`). Si hubiera que rehacerlo (servidor nuevo,
usuario recreado):

1. cPanel → **MySQL Databases** → sección *Add User To Database*.
2. Usuario `ssfdgwtm_tribu`, base de datos `ssfdgwtm_vhm` → **Add**.
3. En *Manage User Privileges* marcar **solo `SELECT`** → **Make Changes**.

cPanel no permite limitarlo a una sola tabla; con SELECT el usuario puede leer toda
`ssfdgwtm_vhm`, pero no modificarla. Comprobar desde phpMyAdmin con ese usuario:
`SELECT id, smtp_host FROM ssfdgwtm_vhm.config_email WHERE id = 1;`

## Planes

Un plan con suscripciones (activas o históricas) no se puede borrar (409). La FK
`tribu_suscripciones.suscripcion_id → suscripciones.id` sigue con `ON DELETE CASCADE`:
no se altera en caliente porque requiere `DROP FOREIGN KEY` + `ADD` sobre la tabla de
suscripciones en producción. Si se decide cambiar a `RESTRICT`, hacerlo en una ventana
de mantenimiento:

```sql
SHOW CREATE TABLE tribu_suscripciones;  -- obtener el nombre de la FK
ALTER TABLE tribu_suscripciones DROP FOREIGN KEY <nombre_fk>,
  ADD CONSTRAINT fk_ts_plan FOREIGN KEY (suscripcion_id) REFERENCES suscripciones(id) ON DELETE RESTRICT;
```

## Archivos que no debe servir el servidor web

La app vive dentro de `public_html/latribu`, así que LiteSpeed puede servir directamente
cualquier archivo real de la carpeta (código, `package.json`, `.env`, `stderr.log`, …)
sin pasar por Node.

- El repo ya incluye `.htaccess` con `Require all denied` (y `Deny from all` para
  Apache 2.2) en `src/`, `lib/`, `scripts/` y `test/`.
- `node_modules/`, `package.json`, `.env` y `stderr.log` están en la raíz y
  no se pueden proteger desde el repo: el `.htaccess` raíz de la app lo gestiona
  cPanel/Passenger. Añade este bloque al `.htaccess` raíz (`public_html/latribu/.htaccess`),
  **fuera** del bloque `# DO NOT REMOVE. CLOUDLINUX PASSENGER CONFIGURATION BEGIN/END`:

**Nunca denegar el startup file (app.js) ni la carpeta de la app: provoca 403 en todo el sitio.**
En LiteSpeed/lsnode (Passenger), `app.js` es el *Application startup file* de La Tribu: si un
`FilesMatch` o un `Require all denied` lo alcanza, todas las URL de `/latribu` devuelven 403.

```apache
RedirectMatch 404 ^/latribu/(node_modules|src|lib|scripts|test)(/|$)
<FilesMatch "^(package(-lock)?\.json|.*\.log|.*\.md|\.env.*)$">
Require all denied
</FilesMatch>
```

  Solo bloquea archivos reales del disco: las rutas de la app (`/latribu/`, `/latribu/api/*`,
  `/latribu/admin/*`, `/latribu/js/*`, …) no corresponden a archivos de la raíz y siguen
  llegando a Passenger. Ninguna ruta de Express empieza por `/src`, `/lib`, `/scripts`,
  `/test` ni `/node_modules`, y `public/` no tiene archivos `.md`, `.log`, `.env*` ni
  `package*.json`. `app.js` requiere `./src/...` y `./lib/...` con `require` (sistema de
  archivos, no HTTP), así que los `.htaccess` de esas carpetas no afectan al arranque.
- Verificación obligatoria tras pegar el bloque: `/latribu/` y `/latribu/health` deben
  responder 200/302 (también `/latribu/api/videos`); `/latribu/package.json`,
  `/latribu/stderr.log`, `/latribu/src/index.js` y
  `/latribu/node_modules/express/package.json` deben dar 403/404. **Si `/latribu/` da 403,
  quitar el bloque inmediatamente** y revisar que nada del `.htaccess` coincida con `app.js`.
- `app.js` (raíz) queda sin denegar a propósito. Si `https://vhm.com.pe/latribu/app.js`
  muestra código del servidor, la solución es mover la app fuera de `public_html`, no
  denegar el startup file.
- Recomendado a medio plazo: mover la app fuera de `public_html` (p. ej. `~/apps/latribu`)
  y dejar que cPanel solo publique la URL `/latribu` vía Passenger.
