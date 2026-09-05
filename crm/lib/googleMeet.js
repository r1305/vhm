'use strict';

const { google } = require('googleapis');
const pool = require('./db');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI || 'https://vhm.com.pe/crm/api/integraciones/google/callback';

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function getAuthUrl() {
  return getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
  });
}

async function getTokens() {
  const [[row]] = await pool.query(
    "SELECT valor FROM configuracion WHERE clave = 'google_tokens' LIMIT 1"
  );
  return row ? JSON.parse(row.valor) : null;
}

async function saveTokens(tokens) {
  await pool.query(
    "INSERT INTO configuracion (clave, valor) VALUES ('google_tokens', ?) ON DUPLICATE KEY UPDATE valor = ?",
    [JSON.stringify(tokens), JSON.stringify(tokens)]
  );
}

async function getAuthedClient() {
  const tokens = await getTokens();
  if (!tokens) throw new Error('Google no conectado');
  const auth = getOAuth2Client();
  auth.setCredentials(tokens);
  // Guardar tokens nuevos si se refrescaron
  auth.on('tokens', async (t) => {
    const updated = { ...tokens, ...t };
    await saveTokens(updated);
  });
  return auth;
}

async function createMeetLink({ titulo, fecha, horaInicio, horaFin }) {
  const auth = await getAuthedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const start = `${fecha}T${horaInicio}:00`;
  const end   = `${fecha}T${horaFin}:00`;

  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    requestBody: {
      summary: titulo,
      start:   { dateTime: start, timeZone: 'America/Lima' },
      end:     { dateTime: end,   timeZone: 'America/Lima' },
      conferenceData: {
        createRequest: { requestId: `vhm-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    },
  });

  const link = data.hangoutLink || data.conferenceData?.entryPoints?.[0]?.uri || null;

  // Borrar el evento inmediatamente — el link de Meet sigue funcionando
  if (data.id) {
    calendar.events.delete({ calendarId: 'primary', eventId: data.id }).catch(() => {});
  }

  return link;
}

async function isConnected() {
  const tokens = await getTokens();
  return !!(tokens?.refresh_token);
}

async function disconnect() {
  await pool.query("DELETE FROM configuracion WHERE clave = 'google_tokens'");
}

module.exports = { getAuthUrl, saveTokens, createMeetLink, isConnected, disconnect };
