const express = require('express');
const router = express.Router();

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

router.get('/config', (req, res) => {
  res.json({ enabled: chatHabilitado(), nombre: 'Clara', titulo: 'Tu Guía 24/7' });
});

// SECURITY-REVIEW: realiza una llamada HTTP externa a la API de OpenAI con
// contenido provisto por el usuario. La API key proviene de variables de
// entorno, se sanea/limita la entrada y los detalles de error no se exponen.
router.post('/chat', async (req, res) => {
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
