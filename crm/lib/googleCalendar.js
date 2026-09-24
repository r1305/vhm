'use strict';

const { google } = require('googleapis');
const pool = require('./db');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_REDIRECT = process.env.GOOGLE_REDIRECT_URI
  ? process.env.GOOGLE_REDIRECT_URI.replace('/callback', '/calendar-callback')
  : 'https://vhm.com.pe/crm/api/terapeutas/google/calendar-callback';

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, BASE_REDIRECT);
}

// state = base64(terapeutaId) para recuperarlo en el callback
function getAuthUrl(terapeutaId) {
  return getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    state: Buffer.from(String(terapeutaId)).toString('base64'),
  });
}

async function saveTokens(terapeutaId, tokens) {
  await pool.execute(
    'UPDATE terapeutas SET google_calendar_tokens = ? WHERE id = ?',
    [JSON.stringify(tokens), terapeutaId]
  );
}

async function getTokens(terapeutaId) {
  const [[row]] = await pool.execute(
    'SELECT google_calendar_tokens FROM terapeutas WHERE id = ?',
    [terapeutaId]
  );
  return row?.google_calendar_tokens ? JSON.parse(row.google_calendar_tokens) : null;
}

async function getAuthedClient(terapeutaId) {
  const tokens = await getTokens(terapeutaId);
  if (!tokens) throw new Error('Google Calendar no conectado');
  const auth = getOAuth2Client();
  auth.setCredentials(tokens);
  auth.on('tokens', async (t) => {
    await saveTokens(terapeutaId, { ...tokens, ...t });
  });
  return auth;
}

async function isConnected(terapeutaId) {
  const tokens = await getTokens(terapeutaId);
  return !!(tokens?.refresh_token || tokens?.access_token);
}

async function disconnect(terapeutaId) {
  await pool.execute(
    'UPDATE terapeutas SET google_calendar_tokens = NULL WHERE id = ?',
    [terapeutaId]
  );
}

// Devuelve array de { start, end } (strings ISO) de eventos ocupados en el rango
async function getBusySlots(terapeutaId, fechaInicio, fechaFin) {
  const auth = await getAuthedClient(terapeutaId);
  const calendar = google.calendar({ version: 'v3', auth });

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: new Date(`${fechaInicio}T00:00:00-05:00`).toISOString(),
      timeMax: new Date(`${fechaFin}T23:59:59-05:00`).toISOString(),
      timeZone: 'America/Lima',
      items: [{ id: 'primary' }],
    },
  });

  return (data.calendars?.primary?.busy || []).map((b) => ({
    start: b.start,
    end: b.end,
  }));
}

module.exports = { getAuthUrl, saveTokens, getTokens, isConnected, disconnect, getBusySlots, BASE_REDIRECT };
