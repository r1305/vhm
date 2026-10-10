function cerrarServidor(server) {
  return new Promise((resolve) => {
    if (!server || typeof server.close !== 'function' || server.listening === false) return resolve();
    try {
      server.close(() => resolve());
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    } catch (_) {
      resolve();
    }
  });
}

function crearGracefulShutdown({
  obtenerServidor = () => null,
  detenerTimers = [],
  cerrarPool = async () => {},
  cerrarMailer = () => {},
  timeoutMs = 5000,
  salir = (codigo) => process.exit(codigo),
  log = console,
} = {}) {
  let enCurso = null;

  return function gracefulShutdown(signal) {
    if (enCurso) return enCurso;
    log.log(`[latribu] ${signal || 'apagado'} recibido, cerrando recursos...`);

    const seguridad = setTimeout(() => {
      log.error(`[latribu] El apagado superó ${timeoutMs} ms, se fuerza la salida`);
      salir(1);
    }, timeoutMs);
    if (typeof seguridad.unref === 'function') seguridad.unref();

    enCurso = (async () => {
      for (const detener of detenerTimers) {
        try { detener(); } catch (err) { log.error('[latribu] detener timer:', err.message); }
      }
      await cerrarServidor(obtenerServidor());
      try { await cerrarPool(); } catch (err) { log.error('[latribu] cerrar pool:', err.message); }
      try { await cerrarMailer(); } catch (err) { log.error('[latribu] cerrar mailer:', err.message); }
    })().then(() => {
      clearTimeout(seguridad);
      salir(0);
    });
    return enCurso;
  };
}

function registrarSenales(gracefulShutdown, proceso = process) {
  const handler = (signal) => { gracefulShutdown(signal); };
  proceso.on('SIGTERM', handler);
  proceso.on('SIGINT', handler);
  return () => {
    proceso.removeListener('SIGTERM', handler);
    proceso.removeListener('SIGINT', handler);
  };
}

module.exports = { crearGracefulShutdown, registrarSenales, cerrarServidor };
