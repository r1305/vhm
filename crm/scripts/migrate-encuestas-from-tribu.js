/**
 * Migra encuestas específicas de ssfdgwtm_tribu → ssfdgwtm_crm
 * Copia: encuesta + preguntas + opciones + respuestas + detalle
 * Uso: node scripts/migrate-encuestas-from-tribu.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mysql = require('mysql2/promise');

const TITULOS = [
  '¿Cómo te ha ido en tus sesiones con la Ps. Pamela?',
  '¿Cómo te ha ido en tus sesiones con la Ps. Nohelia?',
];

async function main() {
  const src = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
    user: 'ssfdgwtm_tribu', password: '$Tribu$2026$', database: 'ssfdgwtm_tribu',
    timezone: '-05:00',
  });
  const dst = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    timezone: '-05:00',
  });

  try {
    for (const titulo of TITULOS) {
      const [[enc]] = await src.execute(
        'SELECT id, titulo, descripcion, slug, activa, created_at FROM encuestas WHERE titulo = ? LIMIT 1',
        [titulo]
      );
      if (!enc) { console.log(`⚠️  No encontrada: "${titulo}"`); continue; }

      // Verificar si ya existe en CRM
      const [[existing]] = await dst.execute(
        'SELECT id FROM crm_encuestas WHERE titulo = ? LIMIT 1', [titulo]
      );
      if (existing) { console.log(`⏭️  Ya existe en CRM: "${titulo}" (id=${existing.id})`); continue; }

      // Generar slug único en CRM
      let slug = enc.slug;
      const [[slugConflict]] = await dst.execute('SELECT id FROM crm_encuestas WHERE slug = ? LIMIT 1', [slug]);
      if (slugConflict) slug = slug + '-tribu';

      // Insertar encuesta
      const [insEnc] = await dst.execute(
        'INSERT INTO crm_encuestas (titulo, descripcion, slug, activa, created_at) VALUES (?, ?, ?, ?, ?)',
        [enc.titulo, enc.descripcion, slug, enc.activa, enc.created_at]
      );
      const newEncId = insEnc.insertId;
      console.log(`✅ Encuesta creada: "${titulo}" → crm id=${newEncId}`);

      // Preguntas
      const [preguntas] = await src.execute(
        'SELECT id, texto, tipo, orden, obligatoria FROM encuesta_preguntas WHERE encuesta_id = ? ORDER BY orden ASC, id ASC',
        [enc.id]
      );
      const preguntaIdMap = new Map(); // tribu_id → crm_id

      for (const p of preguntas) {
        const [insP] = await dst.execute(
          'INSERT INTO crm_encuesta_preguntas (encuesta_id, texto, tipo, orden, obligatoria) VALUES (?, ?, ?, ?, ?)',
          [newEncId, p.texto, p.tipo, p.orden, p.obligatoria]
        );
        preguntaIdMap.set(p.id, insP.insertId);

        // Opciones
        const [opciones] = await src.execute(
          'SELECT texto, orden FROM encuesta_opciones WHERE pregunta_id = ? ORDER BY orden ASC, id ASC',
          [p.id]
        );
        const opcionIdMap = new Map();
        for (const o of opciones) {
          const [insO] = await dst.execute(
            'INSERT INTO crm_encuesta_opciones (pregunta_id, texto, orden) VALUES (?, ?, ?)',
            [insP.insertId, o.texto, o.orden]
          );
          opcionIdMap.set(`${p.id}-${o.orden}`, insO.insertId);
        }
        preguntaIdMap.set(`opciones-${p.id}`, opcionIdMap);
      }

      // Respuestas
      const [respuestas] = await src.execute(
        'SELECT id, created_at FROM encuesta_respuestas WHERE encuesta_id = ? ORDER BY id ASC',
        [enc.id]
      );
      console.log(`   → ${respuestas.length} respuestas a migrar`);

      for (const r of respuestas) {
        const [insR] = await dst.execute(
          'INSERT INTO crm_encuesta_respuestas (encuesta_id, created_at) VALUES (?, ?)',
          [newEncId, r.created_at]
        );
        const newRespId = insR.insertId;

        const [detalles] = await src.execute(
          `SELECT d.pregunta_id, d.texto_respuesta,
                  o.texto AS opcion_texto, o.orden AS opcion_orden
           FROM encuesta_respuesta_detalle d
           LEFT JOIN encuesta_opciones o ON o.id = d.opcion_id
           WHERE d.respuesta_id = ?`,
          [r.id]
        );

        for (const d of detalles) {
          const newPregId = preguntaIdMap.get(d.pregunta_id);
          if (!newPregId) continue;

          let newOpcionId = null;
          if (d.opcion_texto !== null) {
            const opMap = preguntaIdMap.get(`opciones-${d.pregunta_id}`);
            newOpcionId = opMap?.get(`${d.pregunta_id}-${d.opcion_orden}`) ?? null;
          }

          await dst.execute(
            'INSERT INTO crm_encuesta_respuesta_detalle (respuesta_id, pregunta_id, opcion_id, texto_respuesta) VALUES (?, ?, ?, ?)',
            [newRespId, newPregId, newOpcionId, d.texto_respuesta]
          );
        }
      }
      console.log(`   ✅ Migración completa para "${titulo}"`);
    }
  } finally {
    await src.end();
    await dst.end();
  }
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
