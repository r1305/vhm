# AGENTS.md — VHM CRM

Reglas del proyecto. Leer antes de tocar código.

## Zona horaria: SIEMPRE America/Lima

El proyecto opera 100% en hora de Lima (UTC−5, sin horario de verano).
Perú no aplica DST, así que el offset es fijo: **-05:00**.

### Regla principal

Toda fecha/hora debe resolverse en hora de Lima. El servidor donde corra puede
estar en otra zona (en producción se ha detectado MySQL en `CEST`, UTC+2), por
lo que **nunca se debe confiar en la zona del servidor**.

### Cómo se aplica

| Capa | Cómo | Dónde |
|------|------|-------|
| Node | `process.env.TZ = 'America/Lima'` | `lib/db.js` y `app.js`, antes de usar cualquier fecha |
| MySQL | `SET time_zone = '-05:00'` en cada conexión del pool | `lib/db.js` (`pool.on('connection')`) |
| mysql2 | `timezone: '-05:00'` al crear el pool | `lib/db.js` |
| Frontend | `timeZone: 'America/Lima'` en `toLocaleString`/`Intl` | `public/*.js` |
| Cron | `node-cron` con `{ timezone: 'America/Lima' }` | `app.js` |
| Google | `timeZone: 'America/Lima'` en eventos | `lib/googleCalendar.js`, `lib/googleMeet.js` |

### Al escribir código nuevo

```js
// ❌ Incorrecto: depende de la zona del servidor
const s = fecha.toLocaleString('es-PE');
const h = fecha.getHours();

// ✅ Correcto: siempre Lima, ignorando la zona del navegador
const s = fecha.toLocaleString('es-PE', { timeZone: 'America/Lima' });
```

En SQL es aceptable usar `NOW()`/`CURDATE()` **siempre que la conexión venga de
`lib/db.js`**, porque ahí la zona de sesión ya está fijada en `-05:00`. Si se
necesita SQL fuera de la app (phpMyAdmin, un script suelto), fijar la zona antes:

```sql
SET time_zone = '-05:00';
```

No usar `UTC_TIMESTAMP()` para lógica de negocio.

### Al crear tablas

- **Horas de citas** → `DATE` + `TIME` separados (`citas.fecha`, `citas.hora_inicio`).
  Son literales, no se convierten por zona. Es lo correcto para agendas.
- **`created_at` / `updated_at`** → `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`.
  MySQL los guarda como instante absoluto, así que son seguros.
- No usar `DATETIME` para marcas de tiempo de eventos: no llevan zona y se
  interpretan de forma ambigua.

### Verificación

Después de tocar fechas, comprobar que MySQL y Node coinciden:

```sql
SELECT @@session.time_zone, NOW(), UTC_TIMESTAMP();
-- session.time_zone debe ser -05:00 y NOW() debe ser UTC - 5 horas
```

## Sesiones de paciente

La fuente de verdad es `paciente_paquetes`. Los fragmentos SQL canónicos están
exportados como `SQL` desde `lib/paquetesPaciente.js`:

- `SQL.sesionesTotal(p)` — total adquirido (legacy solo si no hay paquetes)
- `SQL.citasConfirmadas(p)` — citas realizadas / no show
- `SQL.sesionesPendientes(p)` — sesiones agendables (solo paquete vigente)
- `SQL.paqueteNombre(p)` — paquete vigente o `NULL`
- `SQL.sinSesiones(p)` — nunca tuvo sesiones en ningún sistema
- `SQL.paquetesComprados(p)` — base de la tasa de retención

Usar estos fragmentos en cualquier consulta nueva, en vez de reescribir la
lógica. Así el dashboard, el listado y el detalle no pueden divergir.

## Roles

La tabla `terapeutas` guarda también admins y superadmins. Cualquier consulta
que liste terapeutas para selectores o métricas debe incluir
`WHERE rol = 'terapeuta'`. Ver `routes/pages.js` (`/calendario`, ocupación) y
`routes/leads.js` (auto-asignación).

Para decidir si un rol de *staff* (ve a todos los pacientes), usar
`isStaffAdmin(rol)` de `lib/roles.js` en lugar de comparar contra el literal
`'terapeuta'`, para que un rol nuevo no requiera editar cada comparación.

## Aislamiento por terapeuta

El listado de pacientes ya aplica `ownerFilter`, pero los endpoints que reciben
un `pid` en la ruta no lo hacen solos. Al añadir uno hay que comprobar que el
paciente pertenece al terapeuta que pregunta:

- `puedeVerPaciente(req, pid)` en `routes/pacientes.js` devuelve `true` para
  roles de staff y, si no, exige `pacientes.terapeuta_id = req.user.id`.
- Sin esa comprobación, conocer el id de otro paciente basta para leer sus
  paquetes, sesiones usadas y cuotas.

Cubierto por los endpoints `/pacientes/:pid`, `/pacientes/:pid/sesiones-resumen`
y `/pacientes/:pid/paquetes-adquiridos`.

## Estado en el frontend

No guardar listados de pacientes en `window.CRM`. Cada vista los cargaba con
filtros distintos y el último en escribir ganaba, así que el mismo buscador
mostraba pacientes distintos según la página desde la que se abría. El
autocompletado de "Nueva cita" consulta `/pacientes?q=`, que aplica
`ownerFilter` y la búsqueda real en el servidor.

## Commits

Mensajes en español, formato convencional (`fix(crm):`, `feat(crm):`).
El usuario pide siempre subir los cambios tras verificarlos.

## Despliegue cPanel

Todo desarrollo debe asumir despliegue en **cPanel** (shared hosting típico) usando Node.js App (Application Manager) o similar.

### Pautas obligatorias

- **Entorno de ejecución**: Evitar procesos huérfanos. No usar `nodemon`, `ts-node-dev` ni watchers en producción. En desarrollo local pueden usarse, pero en producción usar `node` directo.
- **Instancias/child processes**: Evitar crear múltiples instancias o child processes innecesarios. Si se usa clustering, debe justificarse y limitarse a **1–2 workers máximo (ideal 1)**.
- **Conexiones a base de datos**: NO abrir conexiones DB nuevas por request. Usar **pool de conexiones** (Mongoose ya lo gestiona con pool). Reutilizar **singleton de DB**. No crear conexiones ad-hoc.
- **Timers**: Evitar `setInterval`/`setTimeout` largos sin limpieza. Si son necesarios, explicar por qué y garantizar su `clearInterval`/`clearTimeout` al cierre del servidor/sesión.
- **Gestión de procesos**: No usar PM2 (suele no estar disponible o no permitido). No asumir `systemd`.
- **Uploads**: Si se guardan localmente, limitar concurrencia y limpieza periódica. Si usan Cloudinary, mantenerlo tal como está.
- **WebSockets/Socket.IO**: Si se usan, deben compartir **un único servidor HTTP** (no crear servidor aparte) y evitar re-conexiones masivas.
- **Rate-limit**: Debe ser **por IP + memoria** (no Redis a menos que ya exista y esté permitido). Usar `express-rate-limit` con store en memoria tal como está ahora.
- **Archivos temporales**: Evitar generar archivos temporales sin borrar (`tmp`). Eliminar siempre al terminar su uso.
- **Recursos**: Minimizar uso CPU/memoria. Los archivos estáticos deben servirse por **cPanel/nginx reverse proxy** cuando sea posible.
- **Comandos de arranque**: `npm start` debe ser simple (`node app.js` o `node server.js`). No debe invocar watchers/dev-tools.
- **Limpieza de handles**: Verificar que al cerrar sesión/requests no queden handles abiertos (servidor, sockets, timers, streams, conexiones).

### Checklist de despliegue cPanel

- [ ] sin watchers
- [ ] sin child_process
- [ ] pool reutilizado
- [ ] sin timers sin cleanup
- [ ] 1 instancia
- [ ] sin nodemon prod
- [ ] start simple