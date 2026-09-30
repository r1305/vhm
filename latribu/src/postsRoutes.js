const { Router } = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { authMiddleware, JWT_SECRET } = require('./auth');
const { tribuAuthMiddleware, TRIBU_JWT_SECRET } = require('./tribuAuthRoutes');
const {
  crearUploadImagen, guardarImagen, borrarImagen,
} = require('./lib/subidaImagen');

const router = Router();

const BASE = (process.env.APP_MOUNT_PATH || '').replace(/\/$/, '');
const ASSET_BASE = (process.env.SITE_URL || '').replace(/\/$/, '') || BASE;
const DESTINO = 'tribu/posts';
const UPLOAD_URL_BASE = `${ASSET_BASE}/uploads/${DESTINO}`;

const MAX_CONTENIDO = 2000;

// Se valida la firma binaria del archivo, no el Content-Type que declara el
// cliente: con diskStorage + fileFilter por mimetype se aceptaba un .html con
// 'Content-Type: image/png', y como el directorio se sirve con express.static
// el navegador lo ejecutaba en el dominio de la app (robo de los tokens de
// localStorage). Ver lib/subidaImagen.js.
const upload = crearUploadImagen({ limiteBytes: 5 * 1024 * 1024 });

/** Persiste la foto subida y devuelve su URL, o null si no se envió ninguna. */
async function persistirFoto(file) {
  return guardarImagen(file, {
    destino: DESTINO, prefijo: 'post', assetBase: ASSET_BASE,
  });
}

// ── Anti-spam: máx. 5 publicaciones por usuario cada 5 minutos ──
// El contador vive en la tabla, no en un Map del proceso: asi sobrevive a un
// reinicio y es el mismo limite si la app corre en varias instancias.
// Además, como solo cuenta filas realmente creadas, una publicación rechazada
// por validación no consume cuota.
const MAX_PUBLICOS_POR_VENTANA = 5;
const VENTANA_MINUTOS = 5;

async function excedeLimite(userId) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS c FROM tribu_posts
     WHERE tribu_user_id = ? AND created_at >= (NOW() - INTERVAL ? MINUTE)`,
    [userId, VENTANA_MINUTOS]
  );
  return Number(row.c) >= MAX_PUBLICOS_POR_VENTANA;
}

function esAdmin(req) {
  return !!(req.user && (req.user.rol === 'SUPER_ADMIN' || req.user.rol === 'ADMIN'));
}

function requireAdmin(req, res, next) {
  if (esAdmin(req)) return next();
  return res.status(403).json({ error: 'Acceso restringido a administradores' });
}

// Acepta token de miembro (tribu) o de administrador (admin panel)
function postAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, TRIBU_JWT_SECRET);
    if (payload && payload.tribu) {
      req.tribuUser = payload;
      return next();
    }
  } catch (_) { /* puede ser token de admin */ }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (_) { /* token inválido */ }
  return res.status(401).json({ error: 'Token inválido o expirado' });
}

function normalizarContenido(raw) {
  const texto = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim();
  // Antes se recortaba en silencio y la persona publicaba media frase sin
  // enterarse. Ahora se rechaza y se le dice cuanto le sobra.
  if (texto.length > MAX_CONTENIDO) {
    const err = new Error(`Es demasiado largo. Máximo ${MAX_CONTENIDO} caracteres (te sobran ${texto.length - MAX_CONTENIDO}).`);
    err.status = 400;
    throw err;
  }
  return texto;
}

function iniciales(nombre, apellido) {
  const a = nombre && nombre.length ? nombre[0] : '';
  const b = apellido && apellido.length ? apellido[0] : '';
  return ((a + b).toUpperCase()) || '?';
}

function mapPost(row, viewerId) {
  const autorNombre = row.autor_nombre || '';
  const autorApellido = row.autor_apellido || '';
  return {
    id: row.id,
    contenido: row.contenido,
    foto_url: row.foto_url || null,
    likes: Number(row.likes || 0),
    liked: !!row.liked,
    mine: viewerId != null && Number(row.tribu_user_id) === Number(viewerId),
    mine_edit: !!row.editado,
    activo: !!row.activo,
    created_at: row.created_at,
    updated_at: row.updated_at,
    autor: {
      id: row.tribu_user_id,
      nombre: autorNombre,
      apellido: autorApellido,
      nombre_completo: `${autorNombre} ${autorApellido}`.trim(),
      iniciales: iniciales(autorNombre, autorApellido),
      foto_url: row.autor_foto_url || null,
    },
  };
}

const SELECT_POST = `
  SELECT p.id, p.tribu_user_id, p.contenido, p.foto_url, p.likes, p.activo, p.editado,
         p.created_at, p.updated_at,
         u.nombre AS autor_nombre, u.apellido AS autor_apellido, u.foto_url AS autor_foto_url,
         EXISTS(SELECT 1 FROM tribu_post_likes pl
                WHERE pl.post_id = p.id AND pl.tribu_user_id = ?) AS liked
  FROM tribu_posts p
  JOIN tribu_users u ON u.id = p.tribu_user_id`;

function borrarFoto(fotoUrl) {
  borrarImagen(fotoUrl, DESTINO);
}

function esTruthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

async function obtenerPost(id, viewerId, soloActivos = true) {
  const where = soloActivos ? 'WHERE p.id = ? AND p.activo = 1' : 'WHERE p.id = ?';
  const [rows] = await pool.execute(`${SELECT_POST} ${where} LIMIT 1`, [viewerId || 0, id]);
  return rows.length ? mapPost(rows[0], viewerId) : null;
}

function parsePaginacion(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const req = parseInt(query.limit);
  const limit = [10, 20, 30, 50].includes(req) ? req : 10;
  return { page, limit, offset: (page - 1) * limit };
}

// ── Feed de la comunidad ──
router.get('/', tribuAuthMiddleware, async (req, res) => {
  try {
    const viewerId = req.tribuUser.id;
    const { page, limit, offset } = parsePaginacion(req.query);

    let where = 'WHERE p.activo = 1';
    const params = [];
    if (esTruthy(req.query.mine)) { where += ' AND p.tribu_user_id = ?'; params.push(viewerId); }
    else if (req.query.user_id) {
      const uid = parseInt(req.query.user_id);
      if (Number.isInteger(uid) && uid > 0) { where += ' AND p.tribu_user_id = ?'; params.push(uid); }
    }
    const orden = String(req.query.orden || '').toLowerCase() === 'likes'
      ? 'ORDER BY p.likes DESC, p.created_at DESC'
      : 'ORDER BY p.created_at DESC, p.id DESC';

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM tribu_posts p ${where}`, params);
    const [rows] = await pool.execute(`${SELECT_POST} ${where} ${orden} LIMIT ? OFFSET ?`, [
      viewerId, ...params, limit, offset,
    ]);

    res.json({
      data: rows.map(r => mapPost(r, viewerId)),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error('[latribu] Error al obtener posts:', err.message);
    res.status(500).json({ error: 'Error al obtener las publicaciones' });
  }
});

// ── Moderación (admin) ──
router.get('/admin', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { page, limit, offset } = parsePaginacion(req.query);
    const q = String(req.query.q || '').trim();
    const filtro = String(req.query.activo || '').toLowerCase();

    let where = 'WHERE 1=1';
    const params = [];
    if (filtro === '1' || filtro === '0') { where += ' AND p.activo = ?'; params.push(Number(filtro)); }
    if (q) {
      where += ' AND (p.contenido LIKE ? OR u.nombre LIKE ? OR u.apellido LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM tribu_posts p JOIN tribu_users u ON u.id = p.tribu_user_id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT p.*, u.nombre AS autor_nombre, u.apellido AS autor_apellido, u.foto_url AS autor_foto_url
       FROM tribu_posts p
       JOIN tribu_users u ON u.id = p.tribu_user_id
       ${where}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({
      data: rows.map(r => mapPost(r, null)),
      total, page, totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error('[latribu] Error al obtener posts (admin):', err.message);
    res.status(500).json({ error: 'Error al obtener las publicaciones' });
  }
});

// Un post moderado se oculta (activo = 0) o, si el moderador decide que no debe
// existir, se borra junto con su foto.
router.delete('/admin/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [rows] = await pool.execute('SELECT id, foto_url FROM tribu_posts WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Publicación no encontrada' });
    if (rows[0].foto_url) borrarFoto(rows[0].foto_url);
    await pool.execute('DELETE FROM tribu_posts WHERE id = ?', [id]);
    res.json({ message: 'Publicación eliminada' });
  } catch (err) {
    console.error('[latribu] Error al eliminar post (admin):', err.message);
    res.status(500).json({ error: 'Error al eliminar la publicación' });
  }
});

router.put('/:id/moderar', authMiddleware, requireAdmin, async (req, res) => {
  try {
    // Sin esta comprobación, una petición sin el campo caía en "ocultar":
    // esTruthy(undefined) es false y una publicación se tapaba en silencio.
    const bruto = req.body?.activo;
    if (bruto === undefined || bruto === null)
      return res.status(400).json({ error: 'Indica si la publicación debe quedar visible u oculta' });
    const activo = esTruthy(bruto) ? 1 : 0;
    const [result] = await pool.execute('UPDATE tribu_posts SET activo = ? WHERE id = ?', [activo, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Publicación no encontrada' });
    res.json({ message: activo ? 'Publicación visible' : 'Publicación oculta', activo: !!activo });
  } catch (err) {
    console.error('[latribu] Error al moderar post:', err.message);
    res.status(500).json({ error: 'Error al moderar la publicación' });
  }
});

// ── Detalle ──
router.get('/:id', tribuAuthMiddleware, async (req, res) => {
  try {
    const post = await obtenerPost(req.params.id, req.tribuUser.id);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada' });
    res.json(post);
  } catch (err) {
    console.error('[latribu] Error al obtener post:', err.message);
    res.status(500).json({ error: 'Error al obtener la publicación' });
  }
});

// ── Crear ──
router.post('/', postAuth, async (req, res) => {
  const memberId = req.tribuUser?.id;
  if (!memberId) return res.status(403).json({ error: 'Solo los miembros pueden publicar' });
  try {
    // Se comprueba antes para no guardar una foto que despues se rechaza. Como
    // el limite se cuenta sobre las filas de la tabla, una peticion que luego
    // falle la validacion no gasta cuota.
    if (await excedeLimite(memberId))
      return res.status(429).json({ error: 'Estás publicando muy rápido. Espera unos minutos.' });
  } catch (e) {
    // Si no se puede consultar, preferimos dejar publicar antes que bloquear.
    console.error('[latribu] Error al comprobar el límite de publicaciones:', e.message);
  }

  upload.single('foto')(req, res, async (err) => {
    // Con memoryStorage el archivo no llega a tocarse el disco, asi que no hay
    // nada que borrar cuando Multer aborta (tamano excedido, varios archivos).
    if (err) return res.status(400).json({ error: err.message || 'Archivo no válido' });

    let foto_url = null;
    try {
      const contenido = normalizarContenido(req.body?.contenido);
      if (req.file) {
        const guardada = await persistirFoto(req.file);
        foto_url = guardada.url;
      }
      if (!contenido && !foto_url) {
        if (foto_url) borrarFoto(foto_url);
        return res.status(400).json({ error: 'Escribe algo o adjunta una foto para publicar' });
      }

      const [result] = await pool.execute(
        'INSERT INTO tribu_posts (tribu_user_id, contenido, foto_url) VALUES (?, ?, ?)',
        [memberId, contenido || null, foto_url]
      );
      const post = await obtenerPost(result.insertId, memberId);
      res.status(201).json({ message: 'Publicación compartida', post });
    } catch (e) {
      if (foto_url) borrarFoto(foto_url);
      // Un archivo que no es una imagen llega aqui con status 400: no es un
      // fallo del servidor, es una entrada invalida.
      if (e.status === 400) return res.status(400).json({ error: e.message });
      console.error('[latribu] Error al crear post:', e.message);
      res.status(500).json({ error: 'Error al publicar' });
    }
  });
});

// ── Editar (autor o admin) ──
router.put('/:id', postAuth, (req, res) => {
  upload.single('foto')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Archivo no válido' });

    const id = parseInt(req.params.id);
    const [rows] = await pool.execute(
      'SELECT id, tribu_user_id, contenido, foto_url FROM tribu_posts WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Publicación no encontrada' });

    const actual = rows[0];
    const esDueño = req.tribuUser && Number(req.tribuUser.id) === Number(actual.tribu_user_id);
    if (!esDueño && !esAdmin(req)) {
      return res.status(403).json({ error: 'No puedes editar esta publicación' });
    }

    // Se guarda la foto nueva antes de tocar nada. Antes se borraba la vieja
    // primero, y si el UPDATE fallaba el post quedaba apuntando a un archivo
    // que ya no existia.
    let fotoNueva = null;
    if (req.file) {
      try {
        fotoNueva = (await persistirFoto(req.file)).url;
      } catch (e) {
        return res.status(400).json({ error: e.message || 'Archivo no válido' });
      }
    }

    let contenido;
    try {
      contenido = normalizarContenido(req.body?.contenido);
    } catch (e) {
      // La foto nueva ya se habia guardado: hay que deshacerla.
      if (fotoNueva) borrarFoto(fotoNueva);
      return res.status(400).json({ error: e.message });
    }
    if (!req.body || req.body.contenido === undefined) contenido = actual.contenido;

    const foto_url = fotoNueva !== null ? fotoNueva
      : esTruthy(req.body?.eliminar_foto) ? null
      : actual.foto_url;

    if (!String(contenido || '').trim() && !foto_url) {
      if (fotoNueva) borrarFoto(fotoNueva);
      return res.status(400).json({ error: 'La publicación no puede quedar vacía' });
    }

    try {
      await pool.execute(
        'UPDATE tribu_posts SET contenido = ?, foto_url = ?, editado = 1 WHERE id = ?',
        [String(contenido || '').trim() || null, foto_url, id]
      );
      // La foto que quedo desplazada se borra solo cuando el UPDATE funciono.
      if (actual.foto_url && actual.foto_url !== foto_url) borrarFoto(actual.foto_url);
      const post = await obtenerPost(id, req.tribuUser?.id || null, false);
      res.json({ message: 'Publicación actualizada', post });
    } catch (e) {
      if (fotoNueva) borrarFoto(fotoNueva);
      console.error('[latribu] Error al editar post:', e.message);
      res.status(500).json({ error: 'Error al actualizar la publicación' });
    }
  });
});

// ── Eliminar (autor o admin) ──
router.delete('/:id', postAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [rows] = await pool.execute('SELECT id, tribu_user_id, foto_url FROM tribu_posts WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Publicación no encontrada' });
    const esDueño = req.tribuUser && Number(req.tribuUser.id) === Number(rows[0].tribu_user_id);
    if (!esDueño && !esAdmin(req)) return res.status(403).json({ error: 'No puedes eliminar esta publicación' });

    if (rows[0].foto_url) borrarFoto(rows[0].foto_url);
    await pool.execute('DELETE FROM tribu_posts WHERE id = ?', [id]);
    res.json({ message: 'Publicación eliminada' });
  } catch (err) {
    console.error('[latribu] Error al eliminar post:', err.message);
    res.status(500).json({ error: 'Error al eliminar la publicación' });
  }
});

// ── Like (toggle) ──
router.post('/:id/like', tribuAuthMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const uid = req.tribuUser.id;
    const [rows] = await pool.execute('SELECT id, activo FROM tribu_posts WHERE id = ? LIMIT 1', [id]);
    if (!rows.length || !rows[0].activo) return res.status(404).json({ error: 'Publicación no encontrada' });

    const [[existente]] = await pool.execute(
      'SELECT 1 AS liked FROM tribu_post_likes WHERE post_id = ? AND tribu_user_id = ? LIMIT 1',
      [id, uid]
    );
    let liked;
    if (existente) {
      await pool.execute('DELETE FROM tribu_post_likes WHERE post_id = ? AND tribu_user_id = ?', [id, uid]);
      await pool.execute('UPDATE tribu_posts SET likes = GREATEST(likes - 1, 0) WHERE id = ?', [id]);
      liked = false;
    } else {
      await pool.execute('INSERT INTO tribu_post_likes (post_id, tribu_user_id) VALUES (?, ?)', [id, uid]);
      await pool.execute('UPDATE tribu_posts SET likes = likes + 1 WHERE id = ?', [id]);
      liked = true;
    }

    const [[row]] = await pool.execute('SELECT likes FROM tribu_posts WHERE id = ?', [id]);
    res.json({ liked, likes: row ? Number(row.likes) : 0 });
  } catch (err) {
    console.error('[latribu] Error al dar like:', err.message);
    res.status(500).json({ error: 'Error al registrar el like' });
  }
});

module.exports = router;
