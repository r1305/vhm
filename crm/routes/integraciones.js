'use strict';

const { Router } = require('express');
const { authAdmin } = require('../lib/auth');
const { getAuthUrl, saveTokens, isConnected, disconnect } = require('../lib/googleMeet');
const { google } = require('googleapis');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI || 'https://vhm.com.pe/crm/api/integraciones/google/callback';

const router = Router();

router.get('/google/auth-url', authAdmin, (req, res) => {
  res.json({ url: getAuthUrl() });
});

router.get('/google/status', authAdmin, async (req, res) => {
  res.json({ connected: await isConnected() });
});

router.delete('/google', authAdmin, async (req, res) => {
  await disconnect();
  res.json({ ok: true });
});

// Callback OAuth2 — Google redirige aquí con ?code=
router.get('/google/callback', async (req, res) => {
  const BASE = (process.env.APP_MOUNT_PATH || '/crm').replace(/\/$/, '');
  const { code } = req.query;
  if (!code) return res.redirect(`${BASE}/integraciones?google=error`);
  try {
    const auth = new (require('googleapis').google.auth.OAuth2)(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const { tokens } = await auth.getToken(code);
    await saveTokens(tokens);
    res.redirect(`${BASE}/integraciones?google=ok`);
  } catch (err) {
    console.error('[google oauth]', err.message);
    res.redirect(`${BASE}/integraciones?google=error`);
  }
});

module.exports = router;
