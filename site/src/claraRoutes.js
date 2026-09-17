const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { JWT_SECRET } = require('./auth');

const router = express.Router();
const TRIBU_JWT_SECRET = JWT_SECRET + '_tribu';

// Chat embebido "Clara" (Opción B). Solo se activa si existe OPENAI_API_KEY.
// La key se lee de variables de entorno y nunca se registra ni se expone.
const MODEL = process.env.CLARA_MODEL || 'gpt-4o-mini';

const SYSTEM_PROMPT = process.env.CLARA_SYSTEM_PROMPT || [
  'Eres "Clara", una guía de acompañamiento emocional disponible 24/7, creada por el Ps. Guillermo para VHM (Bienestar, Relaciones y Superación Personal).',
  'Tu propósito es escuchar con empatía y acompañar a personas que atraviesan rupturas amorosas, duelo, ansiedad o procesos de crecimiento personal.',
  'Hablas en español, con calidez, cercanía y un tono sereno y esperanzador. Validas las emociones antes de orientar.',
  'Ofreces reflexiones y ejercicios prácticos sencillos, sin diagnosticar ni medicar.',
  'No sustituyes la atención psicológica profesional: cuando detectes crisis, riesgo de autolesión o emergencia, recomienda con tacto buscar ayuda profesional o líneas de emergencia locales.',
  'Sé breve y conversacional; evita respuestas excesivamente largas.'
].join(' ');

function chatHabilitado() {
  return !!process.env.OPENAI_API_KEY;
}

async function syncSubscriptionAccess(userId) {
  await pool.execute(
    `UPDATE tribu_suscripciones
     SET activo = 0, auto_renovacion = 0
     WHERE tribu_user_id = ? AND activo = 1 AND fecha_fin < CURDATE()`,
    [userId]
  );
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS total
     FROM tribu_suscripciones
     WHERE tribu_user_id = ? AND activo = 1 AND fecha_fin >= CURDATE()`,
    [userId]
  );
  const subscribed = (row?.total || 0) > 0;
  await pool.execute(
    'UPDATE tribu_users SET is_suscribed = ? WHERE id = ?',
    [subscribed ? 1 : 0, userId]
  );
  return subscribed;
}

async function getTribuUserId(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, TRIBU_JWT_SECRET);
    if (!payload.tribu) return null;
    return payload.id;
  } catch {
    return null;
  }
}

async function requireActiveSubscription(req, res) {
  const userId = await getTribuUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Debes iniciar sesión.' });
    return null;
  }
  const subscribed = await syncSubscriptionAccess(userId);
  if (!subscribed) {
    res.status(403).json({ error: 'Clara está disponible solo para miembros con suscripción activa.' });
    return null;
  }
  return userId;
}

// Rate limiter en memoria: max 15 mensajes por IP en 5 minutos
const chatRateMap = new Map();
const CHAT_MAX = 15;
const CHAT_WINDOW = 5 * 60 * 1000;

function chatRateLimit(ip) {
  const now = Date.now();
  const entry = chatRateMap.get(ip);
  if (!entry || now - entry.start > CHAT_WINDOW) {
    chatRateMap.set(ip, { count: 1, start: now });
    return true;
  }
  entry.count++;
  return entry.count <= CHAT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of chatRateMap) {
    if (now - entry.start > CHAT_WINDOW) chatRateMap.delete(key);
  }
}, 5 * 60 * 1000).unref();

router.get('/config', async (req, res) => {
  const base = { nombre: 'Clara', titulo: 'Tu Guía 24/7' };
  const userId = await getTribuUserId(req);
  if (!userId) return res.json({ ...base, enabled: false });
  const subscribed = await syncSubscriptionAccess(userId);
  if (!subscribed) return res.json({ ...base, enabled: false });
  res.json({ ...base, enabled: chatHabilitado() });
});

// SECURITY-REVIEW: realiza una llamada HTTP externa a la API de OpenAI con
// contenido provisto por el usuario. La API key proviene de variables de
// entorno, se sanea/limita la entrada y los detalles de error no se exponen.
router.post('/chat', async (req, res) => {
  const userId = await requireActiveSubscription(req, res);
  if (!userId) return;

  if (!chatHabilitado()) {
    return res.status(503).json({ error: 'El chat con IA aún no está disponible. Vuelve pronto.' });
  }

  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!chatRateLimit(ip)) {
    return res.status(429).json({ error: 'Demasiadas peticiones. Espera unos minutos antes de intentar de nuevo.' });
  }

  const entrada = (req.body && req.body.mensajes) || [];
  if (!Array.isArray(entrada) || entrada.length === 0) {
    return res.status(400).json({ error: 'Mensaje vacío.' });
  }

  // Solo conservamos los últimos turnos y limitamos longitud por seguridad.
  const historial = entrada.slice(-12).map((m) => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user',
    content: String((m && m.content) || '').slice(0, 4000)
  })).filter((m) => m.content.trim().length > 0);

  if (!historial.length) {
    return res.status(400).json({ error: 'Mensaje vacío.' });
  }

  try {
    const respuestaApi = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...historial],
        temperature: 0.7,
        max_tokens: 600
      })
    });

    if (!respuestaApi.ok) {
      console.error('[clara] Respuesta no OK de OpenAI:', respuestaApi.status);
      return res.status(502).json({ error: 'No se pudo obtener respuesta en este momento.' });
    }

    const data = await respuestaApi.json();
    const texto = data
      && data.choices
      && data.choices[0]
      && data.choices[0].message
      && data.choices[0].message.content;

    res.json({ respuesta: (texto || '').trim() || 'Lo siento, no pude generar una respuesta.' });
  } catch (err) {
    console.error('[clara] Error al contactar OpenAI:', err.message);
    res.status(500).json({ error: 'Error al procesar el mensaje.' });
  }
});

module.exports = router;
