const { Router } = require('express');
const { authMiddleware } = require('./auth');
const { ensureVideoSchema } = require('./ensureSchema');
const {
  getAllCatalog,
  getAccesosForUser,
  setAccesosForUser,
  listUsersWithAccesos,
} = require('./lib/siteAccesos');

const router = Router();

router.use(async (req, res, next) => {
  try {
    await ensureVideoSchema();
    next();
  } catch {
    res.status(503).json({ error: 'Servicio inicializándose' });
  }
});

router.use(authMiddleware);

function requireSuperAdmin(req, res, next) {
  if (req.user?.rol === 'SUPER_ADMIN') return next();
  return res.status(403).json({ error: 'Solo el Super Admin puede realizar esta acción' });
}

router.get('/mi-menu', async (req, res) => {
  try {
    const items = await getAccesosForUser(req.user.id, req.user.rol);
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener menú' });
  }
});

router.get('/', requireSuperAdmin, async (req, res) => {
  try {
    const [catalog, users] = await Promise.all([
      getAllCatalog(),
      listUsersWithAccesos(),
    ]);
    res.json({ catalog, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener accesos' });
  }
});

router.put('/usuario/:id', requireSuperAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    const pool = require('./db');
    const [[target]] = await pool.execute(
      'SELECT id, rol, es_protegido FROM usuarios WHERE id = ?',
      [userId]
    );
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.rol === 'SUPER_ADMIN' || target.es_protegido) {
      return res.status(403).json({ error: 'Los permisos de este usuario no pueden modificarse' });
    }

    const saved = await setAccesosForUser(userId, items, target.rol);
    res.json({ ok: true, items: saved });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Error al guardar accesos' });
  }
});

module.exports = router;
