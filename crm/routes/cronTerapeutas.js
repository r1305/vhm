const { Router } = require('express');
const { requireMenuPermisoApi } = require('../lib/menuPermisos');
const { isStaffAdmin } = require('../lib/roles');
const { listarTerapeutasRecordatorio, guardarSeleccionRecordatorio } = require('../lib/cronTerapeutas');

const router = Router();
const permiso = requireMenuPermisoApi('integraciones');

function soloStaff(req, res, next) {
  if (!isStaffAdmin(req.user?.rol)) return res.status(403).json({ error: 'Sin permiso para esta acción' });
  next();
}

router.get('/', permiso, soloStaff, async (req, res) => {
  try {
    res.json(await listarTerapeutasRecordatorio());
  } catch (err) {
    console.error('[cron/terapeutas/leer]:', err);
    res.status(500).json({ error: 'No se pudo cargar la lista de terapeutas.' });
  }
});

router.put('/', permiso, soloStaff, async (req, res) => {
  const ids = req.body?.terapeuta_ids;
  if (!Array.isArray(ids) || ids.length > 1000) {
    return res.status(400).json({ error: 'terapeuta_ids debe ser una lista' });
  }
  try {
    await guardarSeleccionRecordatorio(ids);
    res.json({ ok: true, terapeutas: await listarTerapeutasRecordatorio() });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[cron/terapeutas/guardar]:', err);
    res.status(500).json({ error: 'No se pudo guardar la selección.' });
  }
});

module.exports = router;
