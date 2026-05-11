const { Router } = require('express');
const PDFDocument = require('pdfkit');
const pool = require('./db');
const { authMiddleware } = require('./auth');
const { enviarNotificacion } = require('./mailer');

const router = Router();

function generarNumeroReclamo() {
  const f = new Date();
  const y = f.getFullYear();
  const m = String(f.getMonth() + 1).padStart(2, '0');
  const d = String(f.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `REC-${y}${m}${d}-${rand}`;
}

// PUBLIC - Registrar reclamo
router.post('/', async (req, res) => {
  try {
    const {
      tipo_documento, numero_documento, nombres, apellidos,
      email, telefono, direccion, departamento, provincia, distrito,
      menor_edad, nombre_apoderado,
      tipo_bien, monto_reclamado, descripcion_bien,
      tipo_reclamo, detalle_reclamo, pedido_consumidor, fecha_incidente
    } = req.body;

    const obligatorios = {
      tipo_documento, numero_documento, nombres, apellidos,
      email, telefono, direccion, departamento, provincia, distrito,
      tipo_bien, monto_reclamado, descripcion_bien,
      tipo_reclamo, detalle_reclamo, pedido_consumidor, fecha_incidente
    };

    const faltantes = Object.entries(obligatorios)
      .filter(([, v]) => !v && v !== 0)
      .map(([k]) => k);

    if (faltantes.length > 0) {
      return res.status(400).json({ error: 'Campos obligatorios faltantes', campos: faltantes });
    }

    const numero_reclamo = generarNumeroReclamo();

    const [result] = await pool.execute(
      `INSERT INTO reclamos (tipo_documento, numero_documento, nombres, apellidos,
        email, telefono, direccion, departamento, provincia, distrito,
        menor_edad, nombre_apoderado, tipo_bien, monto_reclamado, descripcion_bien,
        tipo_reclamo, detalle_reclamo, pedido_consumidor, fecha_incidente, numero_reclamo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo_documento, numero_documento, nombres, apellidos,
       email, telefono, direccion, departamento, provincia, distrito,
       menor_edad ? 1 : 0, nombre_apoderado || null,
       tipo_bien, monto_reclamado, descripcion_bien,
       tipo_reclamo, detalle_reclamo, pedido_consumidor, fecha_incidente, numero_reclamo]
    );

    res.status(201).json({ id: result.insertId, numero_reclamo });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Número de reclamo duplicado, intente nuevamente' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error al registrar el reclamo' });
  }
});

// PUBLIC - Consultar reclamos por número de documento
router.get('/consulta/:numero_documento', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, numero_reclamo, fecha_registro, tipo_reclamo, tipo_bien, descripcion_bien, detalle_reclamo, pedido_consumidor, estado, respuesta, fecha_respuesta, monto_reclamado, fecha_incidente, nombres, apellidos, email, telefono, direccion, departamento, provincia, distrito, tipo_documento, numero_documento FROM reclamos WHERE numero_documento = ? ORDER BY fecha_registro DESC',
      [req.params.numero_documento]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar reclamos' });
  }
});

// PUBLIC/ADMIN - Descargar PDF de un reclamo (diseño tipo formulario)
router.get('/:id/pdf', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM reclamos WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Reclamo no encontrado' });

    const r = rows[0];
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=reclamo_${r.numero_reclamo}.pdf`);
    doc.pipe(res);

    const pageW = 515;
    const leftM = 40;
    const pad = 10;
    const innerW = pageW - pad * 2;
    const gap = 10;
    const col2 = (innerW - gap) / 2;
    const col3 = (innerW - gap * 2) / 3;

    function formatFecha(val) {
      if (!val) return '';
      const d = new Date(val);
      if (isNaN(d)) return String(val);
      return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function formatFechaHora(val) {
      if (!val) return '';
      const d = new Date(val);
      if (isNaN(d)) return String(val);
      return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    }

    function drawFieldset(yStart, yEnd, legend) {
      doc.save();
      doc.roundedRect(leftM, yStart, pageW, yEnd - yStart, 4).lineWidth(0.5).strokeColor('#cccccc').stroke();
      if (legend) {
        const lw = doc.widthOfString(legend, { font: 'Helvetica-Bold', size: 9 }) + 10;
        doc.rect(leftM + 12, yStart - 6, lw, 12).fillColor('#ffffff').fill();
        doc.fillColor('#333333').font('Helvetica-Bold').fontSize(9).text(legend, leftM + 17, yStart - 4);
      }
      doc.restore();
    }

    function drawField(label, value, x, y, w) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#333333').text(label, x, y, { width: w, lineBreak: false });
      doc.roundedRect(x, y + 11, w, 18, 2).lineWidth(0.3).strokeColor('#cccccc').stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor('#000000').text(String(value || ''), x + 3, y + 15, { width: w - 6, height: 14, ellipsis: true, lineBreak: false });
    }

    function drawTextarea(label, value, x, y, w, h) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#333333').text(label, x, y, { width: w });
      doc.roundedRect(x, y + 11, w, h, 2).lineWidth(0.3).strokeColor('#cccccc').stroke();
      doc.font('Helvetica').fontSize(8).fillColor('#000000').text(String(value || ''), x + 4, y + 15, { width: w - 8, height: h - 8 });
      return y + h + 16;
    }

    // === HEADER ===
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#c62828').text('LIBRO DE RECLAMACIONES', leftM, 30, { width: pageW, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor('#666666').text('Conforme al D.S. N° 011-2011-PCM y sus modificatorias', leftM, 48, { width: pageW, align: 'center' });

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text(`N° Reclamo: ${r.numero_reclamo}`, leftM, 65);
    doc.font('Helvetica').fontSize(8).text(`Fecha: ${formatFechaHora(r.fecha_registro)}   |   Estado: ${r.estado}`, leftM, 77);

    // === FIELDSET 1: Identificación del Consumidor ===
    let y = 95;
    const fs1Start = y;
    y += 16;
    const x1 = leftM + pad;
    const x2 = x1 + col2 + gap;

    // Fila 1
    drawField('Tipo de Documento *', r.tipo_documento, x1, y, col2);
    drawField('Número de Documento *', r.numero_documento, x2, y, col2);
    y += 36;

    // Fila 2
    drawField('Nombres *', r.nombres, x1, y, col2);
    drawField('Apellidos *', r.apellidos, x2, y, col2);
    y += 36;

    // Fila 3
    drawField('Correo Electrónico *', r.email, x1, y, col2);
    drawField('Teléfono / Celular *', r.telefono, x2, y, col2);
    y += 36;

    // Fila 4
    drawField('Dirección *', r.direccion, x1, y, innerW);
    y += 36;

    // Fila 5: 3 columnas
    const tx1 = x1;
    const tx2 = x1 + col3 + gap;
    const tx3 = x1 + (col3 + gap) * 2;
    drawField('Departamento *', r.departamento, tx1, y, col3);
    drawField('Provincia *', r.provincia, tx2, y, col3);
    drawField('Distrito *', r.distrito, tx3, y, col3);
    y += 36;

    if (r.menor_edad) {
      drawField('Nombre del Apoderado', r.nombre_apoderado || '', x1, y, innerW);
      y += 36;
    }

    const fs1End = y + 4;
    drawFieldset(fs1Start, fs1End, '1. Identificación del Consumidor');

    // === FIELDSET 2: Bien Contratado ===
    y = fs1End + 14;
    const fs2Start = y;
    y += 16;

    drawField('Tipo de Bien *', r.tipo_bien, x1, y, col2);
    drawField('Monto Reclamado (S/) *', `S/ ${Number(r.monto_reclamado).toFixed(2)}`, x2, y, col2);
    y += 36;

    y = drawTextarea('Descripción del Producto/Servicio *', r.descripcion_bien, x1, y, innerW, 40);

    const fs2End = y + 2;
    drawFieldset(fs2Start, fs2End, '2. Identificación del Bien Contratado');

    // === FIELDSET 3: Detalle de la Reclamación ===
    y = fs2End + 14;
    const fs3Start = y;
    y += 16;

    drawField('Tipo *', r.tipo_reclamo === 'RECLAMO' ? 'Reclamo' : 'Queja', x1, y, col2);
    drawField('Fecha del Incidente *', formatFecha(r.fecha_incidente), x2, y, col2);
    y += 36;

    y = drawTextarea('Detalle del Reclamo/Queja *', r.detalle_reclamo, x1, y, innerW, 50);
    y = drawTextarea('Pedido del Consumidor *', r.pedido_consumidor, x1, y, innerW, 40);

    const fs3End = y + 2;
    drawFieldset(fs3Start, fs3End, '3. Detalle de la Reclamación');

    // === FIELDSET 4: Respuesta (si existe) ===
    if (r.respuesta) {
      y = fs3End + 14;
      const fs4Start = y;

      // Fondo verde
      const fs4EstimatedEnd = y + 16 + 36 + 55 + 16 + 6;
      doc.save();
      doc.roundedRect(leftM, fs4Start, pageW, fs4EstimatedEnd - fs4Start, 4).lineWidth(0.5).fillAndStroke('#f1f8e9', '#a5d6a7');
      doc.restore();

      // Legend
      const legend4 = '4. Respuesta del Proveedor';
      const lw4 = doc.widthOfString(legend4, { font: 'Helvetica-Bold', size: 9 }) + 10;
      doc.rect(leftM + 12, fs4Start - 6, lw4, 12).fillColor('#ffffff').fill();
      doc.fillColor('#2e7d32').font('Helvetica-Bold').fontSize(9).text(legend4, leftM + 17, fs4Start - 4);

      y = fs4Start + 16;
      drawField('Fecha de Respuesta', formatFechaHora(r.fecha_respuesta), x1, y, innerW);
      y += 36;
      drawTextarea('Respuesta del Proveedor', r.respuesta, x1, y, innerW, 55);
    }

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar PDF' });
  }
});

// --- RUTAS PROTEGIDAS (ADMIN) ---

// Listar reclamos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM reclamos');
    const [rows] = await pool.execute(
      'SELECT * FROM reclamos ORDER BY fecha_registro DESC LIMIT ? OFFSET ?',
      [String(limit), String(offset)]
    );

    res.json({ data: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener reclamos' });
  }
});

// Obtener reclamo por ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM reclamos WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Reclamo no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener el reclamo' });
  }
});

// Responder reclamo y notificar por email
router.post('/:id/responder', authMiddleware, async (req, res) => {
  try {
    const { respuesta } = req.body;
    if (!respuesta) return res.status(400).json({ error: 'La respuesta es obligatoria' });

    const [rows] = await pool.execute('SELECT * FROM reclamos WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Reclamo no encontrado' });

    const reclamo = rows[0];

    // Si ya tiene respuesta, solo SUPER_ADMIN puede editar
    if (reclamo.respuesta && req.user.rol !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Solo el Super Admin puede editar respuestas' });
    }

    await pool.execute(
      'UPDATE reclamos SET respuesta = ?, estado = ?, fecha_respuesta = NOW() WHERE id = ?',
      [respuesta, 'RESUELTO', req.params.id]
    );

    // Intentar enviar email
    let emailEnviado = false;
    try {
      await enviarNotificacion(reclamo.email, reclamo.numero_reclamo, respuesta);
      emailEnviado = true;
    } catch (emailErr) {
      console.error('Error enviando email:', emailErr.message);
    }

    res.json({ message: 'Respuesta registrada', emailEnviado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al responder el reclamo' });
  }
});

// Actualizar estado
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { estado } = req.body;
    if (!estado) return res.status(400).json({ error: 'Estado requerido' });

    await pool.execute('UPDATE reclamos SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ message: 'Estado actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el reclamo' });
  }
});

// Eliminar reclamo (solo SUPER_ADMIN)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.rol !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Solo el Super Admin puede eliminar reclamos' });
    }
    const [result] = await pool.execute('DELETE FROM reclamos WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Reclamo no encontrado' });
    res.json({ message: 'Reclamo eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el reclamo' });
  }
});

// Reenviar correo de respuesta
router.post('/:id/reenviar', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM reclamos WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Reclamo no encontrado' });
    
    const reclamo = rows[0];
    if (!reclamo.respuesta) {
      return res.status(400).json({ error: 'Este reclamo no tiene respuesta para reenviar' });
    }
    
    try {
      await enviarNotificacion(reclamo.email, reclamo.numero_reclamo, reclamo.respuesta);
      res.json({ message: `Correo reenviado exitosamente a ${reclamo.email}` });
    } catch (emailErr) {
      console.error('Error reenviando email:', emailErr.message);
      res.status(500).json({ error: `Error al reenviar correo: ${emailErr.message}` });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar el reenvío' });
  }
});

module.exports = router;
