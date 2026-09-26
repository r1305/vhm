'use strict';

const { google } = require('googleapis');
const pool = require('./db');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_REDIRECT = process.env.GOOGLE_CALENDAR_REDIRECT_URI
  || 'https://vhm.com.pe/crm/api/terapeutas/google/calendar-callback';

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, BASE_REDIRECT);
}

// state = base64(terapeutaId) para recuperarlo en el callback
function getAuthUrl(terapeutaId, redirect = 'terapeutas') {
  return getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    state: Buffer.from(JSON.stringify({ id: terapeutaId, redirect })).toString('base64'),
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
    'UPDATE terapeutas SET google_calendar_tokens = NULL, google_calendar_id = NULL WHERE id = ?',
    [terapeutaId]
  );
}

// Devuelve el calendarId del calendario "VHM" del terapeuta, creándolo si no existe
async function getOrCreateVhmCalendar(terapeutaId) {
  // 1. Buscar en caché (BD)
  const [[row]] = await pool.execute(
    'SELECT google_calendar_id FROM terapeutas WHERE id = ?', [terapeutaId]
  );
  if (row?.google_calendar_id) return row.google_calendar_id;

  // 2. Buscar en la cuenta de Google si ya existe un calendario llamado "VHM"
  const auth = await getAuthedClient(terapeutaId);
  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.calendarList.list();
  const existing = (data.items || []).find(c => c.summary === 'VHM');
  let calendarId = existing?.id;

  // 3. Si no existe, crearlo
  if (!calendarId) {
    const { data: created } = await calendar.calendars.insert({
      requestBody: { summary: 'VHM', timeZone: 'America/Lima' },
    });
    calendarId = created.id;
  }

  // 4. Guardar en BD para no volver a buscarlo
  await pool.execute(
    'UPDATE terapeutas SET google_calendar_id = ? WHERE id = ?', [calendarId, terapeutaId]
  );
  return calendarId;
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

// Devuelve array de eventos del calendario en el rango (para mostrar bloqueos externos)
async function getEvents(terapeutaId, fechaInicio, fechaFin) {
  const auth = await getAuthedClient(terapeutaId);
  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date(`${fechaInicio}T00:00:00-05:00`).toISOString(),
    timeMax: new Date(`${fechaFin}T23:59:59-05:00`).toISOString(),
    timeZone: 'America/Lima',
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });
  return (data.items || []).map(e => {
    const allDay = !e.start?.dateTime;
    const start  = e.start?.dateTime || e.start?.date;
    // Para eventos de todo el día, Google devuelve end como día siguiente (exclusivo).
    // Restamos 1 día para obtener la fecha real de fin.
    let end = e.end?.dateTime || e.end?.date;
    if (allDay && end) {
      const d = new Date(end + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      end = d.toISOString().slice(0, 10);
    }
    return { gcal_id: e.id, titulo: e.summary || 'Evento', start, end, allDay };
  });
}

// Crea un evento en Google Calendar y devuelve el gcal_event_id
async function createEvent(terapeutaId, { titulo, fecha, horaInicio, horaFin, descripcion, withMeet = false }) {
  const auth = await getAuthedClient(terapeutaId);
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = await getOrCreateVhmCalendar(terapeutaId);
  const requestBody = {
    summary: titulo,
    description: descripcion || '',
    start: { dateTime: `${fecha}T${horaInicio}:00`, timeZone: 'America/Lima' },
    end:   { dateTime: `${fecha}T${horaFin}:00`,   timeZone: 'America/Lima' },
  };
  if (withMeet) {
    requestBody.conferenceData = {
      createRequest: { requestId: `vhm-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    };
  }
  const { data } = await calendar.events.insert({
    calendarId,
    conferenceDataVersion: withMeet ? 1 : 0,
    requestBody,
  });
  const meetLink = withMeet ? (data.hangoutLink || data.conferenceData?.entryPoints?.[0]?.uri || null) : null;
  return { gcalEventId: data.id, meetLink };
}

// Actualiza un evento existente
async function updateEvent(terapeutaId, gcalEventId, { titulo, fecha, horaInicio, horaFin, descripcion }) {
  const auth = await getAuthedClient(terapeutaId);
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = await getOrCreateVhmCalendar(terapeutaId);
  await calendar.events.patch({
    calendarId,
    eventId: gcalEventId,
    requestBody: {
      summary: titulo,
      description: descripcion || '',
      start: { dateTime: `${fecha}T${horaInicio}:00`, timeZone: 'America/Lima' },
      end:   { dateTime: `${fecha}T${horaFin}:00`,   timeZone: 'America/Lima' },
    },
  });
}

// Elimina un evento de Google Calendar
async function deleteEvent(terapeutaId, gcalEventId) {
  const auth = await getAuthedClient(terapeutaId);
  const calendar = google.calendar({ version: 'v3', auth });
  const calendarId = await getOrCreateVhmCalendar(terapeutaId);
  await calendar.events.delete({ calendarId, eventId: gcalEventId });
}

module.exports = {
  getAuthUrl, saveTokens, getTokens, isConnected, disconnect,
  getBusySlots, getEvents, createEvent, updateEvent, deleteEvent,
  BASE_REDIRECT,
};
