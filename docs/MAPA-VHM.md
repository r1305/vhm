# Mapa de aplicaciones VHM

Documento de referencia: qué hay en cada app (Site, CRM, OpenWA), quién la usa y cómo se conectan.

**Última actualización:** 2026-09-04  
**Repositorio:** [r1305/vhm](https://github.com/r1305/vhm)

---

## Resumen en 30 segundos

| App | URL | Para qué |
|-----|-----|----------|
| **Site** | https://vhm.com.pe/site | Sitio público, La Tribu (masterclass), admin de contenido |
| **CRM** | https://vhm.com.pe/crm | Agenda, pacientes, pagos, reportes, WhatsApp (PWA) |
| **OpenWA** | https://vhm.com.pe/openwa | Servicio WhatsApp (API). Sin pantallas para usuarios |

**Conexión:** Visitante → Site · Staff → CRM · CRM (cron / integraciones) → OpenWA → WhatsApp

---

## Site (`/site`)

**Usuarios:** visitantes web, suscriptores La Tribu, administradores de contenido  
**Stack:** Express · MySQL · Culqi · SMTP

### Landing pública

- Libro de Reclamaciones (formulario + PDF)
- Testimonios en carrusel automático
- Chat IA Clara
- Pixel Meta + botón WhatsApp flotante
- Redes sociales configurables desde admin
- Video de bienvenida La Tribu en la home
- Hero portada configurable (imagen de fondo con fade-in)
- Logo hero circular y redimensionado para no tapar contenido

### La Tribu (`/site/latribu`)

- Catálogo de videos y masterclass
- Acceso con contraseña (gate)
- Registro, login y recuperación de contraseña
- Mi perfil y menú Mi cuenta
- Planes y suscripciones
- Pagos Culqi + tarjetas guardadas
- Mis tarjetas y autorenovación
- Video hero (streaming local `/media/`)

### Panel admin (`/site/admin`)

- Reclamos — listar, responder, reenviar email
- Testimonios — CRUD con fotos
- La Tribu — videos y categorías
- Usuarios Tribu + contraseñas temporales
- Administradores del sitio
- Config: SMTP, pixel, Culqi, WhatsApp, redes sociales, portada hero (imagen de fondo)

---

## CRM (`/crm`)

**Usuarios:** superadmin, recepción, terapeutas (app instalable PWA)  
**Stack:** Express · EJS · MySQL · cliente OpenWA

### Operación diaria (menú activo)

| Módulo | Descripción |
|--------|-------------|
| Dashboard | KPIs y alertas (solo admin / recepción) |
| Agenda | Citas, sesiones, filtros, agrupación por paciente |
| Pacientes | Datos, sesiones, crear usuario Tribu. Filtros "Sin teléfono" / "Sin email". Teléfono normalizado (sin `+`, espacios ni paréntesis, con código de país) |
| Pagos | Registro y seguimiento |
| Terapeutas | Perfiles, teléfono, permisos |
| Calendario | Vistas mes / semana / día + bloqueos. Click en cita abre detalle en modo lectura con botón Editar |
| Mi disponibilidad | Horarios por terapeuta con rangos múltiples por día (ej. 9-12 y 4-7) |
| Agendamiento público | `/crm/agendar/:username` |
| Mi reporte | Vista terapeuta (mobile) |

### Análisis e integraciones

- Reportes — KPIs y gráficos con filtros de fecha
- Analítica web — sesiones, clicks, conversiones
- Integraciones — Meta, TikTok, Instagram, widget web, Google Meet
- Config OpenWA desde panel Integraciones
- Permisos de menú por rol

### Google Meet

- OAuth2 con cuenta Google VHM (conectar/desconectar desde Integraciones)
- Al crear cita con modalidad **Videollamada** se genera automáticamente un link de Google Meet
- Aplica tanto desde el CRM como desde el formulario público de agendamiento
- Si una cita presencial se edita y cambia a Videollamada, se genera el link en ese momento
- Link visible en el detalle de la cita en Calendario y Agenda
- `meet_link` guardado en tabla `citas`

### WhatsApp (vía OpenWA)

- Cron recordatorio a todos los terapeutas
- Broadcast manual a terapeutas
- Envío a número manual desde Integraciones
- Anti-duplicado diario (`cron_send_guard`)

### PWA (app móvil)

- Instalable en dispositivo (manifest + service worker)
- Tracking de instalaciones por usuario
- Icono instalar en cards de terapeutas

### Agendamiento público (`/crm/agendar/:username`)

- Calendario de slots disponibles por terapeuta
- Lookup de paciente por teléfono o email — autocompleta nombre, apellido y email
- Nuevos pacientes creados como `prospecto`; existentes validan saldo de sesiones
- Modalidad Videollamada por defecto; genera link de Meet automáticamente
- Timezone Lima + hora local del visitante si es diferente

### Removidos del menú (ago 2026)

Estos módulos existieron en desarrollo pero **ya no aparecen en el menú activo**:

- Leads
- Historial clínico
- Consentimientos
- Lista de espera
- Email marketing
- Asignación automática

---

## OpenWA (`/openwa`)

**Usuarios:** solo el CRM (backend). No hay UI para personas.  
**Stack:** Node · Baileys · API REST

### API y despliegue

- Servicio Baileys en cPanel (`/openwa`)
- `POST /api/messages/send` (sessionId, chatId)
- Autenticación `X-API-Key`
- Excluido del loop `npm install` y de la limpieza de workers en deploy

### Consumidores en CRM

- `cron-wsp.js` — recordatorios programados
- Integraciones — broadcast y envío manual
- Config URL / API key / session desde CRM

---

## Quién usa qué

| Rol | Site | CRM | OpenWA |
|-----|------|-----|--------|
| Superadmin / recepción | Admin site | CRM completo | — |
| Terapeuta | — | Agenda, calendario, mi reporte, disponibilidad | — |
| Visitante web | Landing, reclamos | — | — |
| Suscriptor Tribu | La Tribu, pagos | — | — |
| Sistema (cron) | Renovaciones Tribu | Cron WhatsApp | Envío WhatsApp |

---

## Rutas útiles

| App | Rutas |
|-----|-------|
| Site | `/site` · `/site/latribu` · `/site/admin` |
| CRM | `/crm/login` · `/crm/agenda` · `/crm/agendar/:username` |
| OpenWA | `/openwa` · `POST /api/messages/send` |
| Deploy | `bash site/deploy.sh` (site + crm, openwa excluido) |

---

## Cómo se conectan las apps

```
Visitante          →  Site (reclamos, Tribu, Culqi)
Staff              →  CRM (agenda, pacientes, reportes)
CRM Pacientes      →  crea usuario en Tribu (DB site)
CRM cron / Integr. →  OpenWA API  →  WhatsApp terapeutas
CRM Videollamada   →  Google Calendar API  →  Meet link en cita
Site cron          →  renovaciones Culqi (suscripciones Tribu)
```

---

## Historial de entregas (por mes)

Resumen de alto nivel — no lista de commits.

| Mes | Site | CRM | OpenWA / Infra |
|-----|------|-----|----------------|
| **May 2026** | Libro reclamaciones, landing, testimonios, SMTP, pixel | — | cPanel optimización |
| **Jun 2026** | Montaje `/site`, roles admin, seguridad | Panel CRM base, integraciones Meta | Repo unificado site + crm |
| **Jul 2026** | Redes sociales, políticas Meta, analítica | Reportes KPIs, widget captación | — |
| **Ago 2026** | La Tribu + Culqi, admin HTML, video hero | Calendario, disponibilidad, PWA, agenda avanzada | OpenWA + deploy unificado |
| **Sep 2026** | Hero portada configurable (upload imagen), logo circular en landing | Google Meet en videollamadas, normalización teléfonos pacientes, filtros sin tel/email, lookup paciente en agendamiento público, detalle cita calendario modo lectura, disponibilidad rangos múltiples | Deploy: openwa excluido de limpieza workers |

---

*Para el inventario detallado con timeline, ver el canvas `vhm-changelog-gantt` o el historial git en `main`.*
