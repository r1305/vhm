const pool = require('./lib/db');
(async () => {
  const [pkgs] = await pool.execute(
    `SELECT pp.id, pp.paciente_id, p.nombre, p.apellido, pp.nombre AS paquete, pp.sesiones, pp.activo, pp.fecha_inicio, pp.vence_at
     FROM paciente_paquetes pp JOIN pacientes p ON p.id = pp.paciente_id
     WHERE pp.nombre LIKE '%Nohelia%' OR p.nombre LIKE '%Nohelia%' OR p.apellido LIKE '%Nohelia%'
     ORDER BY pp.paciente_id, pp.fecha_inicio`
  );
  console.log(JSON.stringify(pkgs, null, 1));

  for (const pk of pkgs) {
    const [[linked]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM citas WHERE paciente_paquete_id = ? AND estado IN ('realizada','no_show')`, [pk.id]);
    const [[legacy]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM citas WHERE paciente_id = ? AND paciente_paquete_id IS NULL AND estado IN ('realizada','no_show') AND DATE(fecha) >= DATE(?)`, [pk.paciente_id, pk.fecha_inicio]);
    const [[todas]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM citas WHERE paciente_id = ?`, [pk.paciente_id]);
    const [detalle] = await pool.execute(
      `SELECT fecha, estado, paciente_paquete_id FROM citas WHERE paciente_id = ? ORDER BY fecha`, [pk.paciente_id]);
    console.log(`\n#${pk.id} ${pk.paquete} (paciente ${pk.paciente_id} ${pk.nombre} ${pk.apellido}) sesiones=${pk.sesiones} activo=${pk.activo} inicio=${String(pk.fecha_inicio).slice(0,10)} vence=${String(pk.vence_at).slice(0,10)}`);
    console.log(`  vinculadas=${linked.n} legacy=${legacy.n} total_citas=${todas.n}`);
    console.log('  citas:', detalle.map(c => `${String(c.fecha).slice(0,10)}:${c.estado}:${c.paciente_paquete_id ?? 'sin-paq'}`).join(' | '));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
