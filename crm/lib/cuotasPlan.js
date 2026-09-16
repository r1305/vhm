const MIN_DIAS_SIGUIENTE_CUOTA = 15;

function normalizeDiasSiguienteCuota(value) {
  const n = parseInt(value, 10);
  if (!n || n < MIN_DIAS_SIGUIENTE_CUOTA) return MIN_DIAS_SIGUIENTE_CUOTA;
  return n;
}

function distributeAmount(precio, numCuotas) {
  const total = Number(precio) || 0;
  const n = Math.max(1, parseInt(numCuotas, 10) || 1);
  const amounts = [];
  const montoBase = Math.floor((total / n) * 100) / 100;
  let montoAsignado = 0;
  for (let i = 0; i < n; i++) {
    const monto = i === n - 1
      ? Math.round((total - montoAsignado) * 100) / 100
      : montoBase;
    montoAsignado += monto;
    amounts.push(monto);
  }
  return amounts;
}

function distributeSessions(total, numCuotas) {
  const n = Math.max(1, parseInt(numCuotas, 10) || 1);
  const sesiones = Math.max(1, parseInt(total, 10) || 1);
  const per = Math.floor(sesiones / n);
  const blocks = [];
  let start = 1;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const count = isLast ? sesiones - start + 1 : per;
    blocks.push({ sesiones_inicio: start, sesiones_fin: start + count - 1 });
    start += count;
  }
  return blocks;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Cuota 1 = fecha inicio; cada siguiente = anterior + dias_siguiente_cuota */
function distributePaymentDates(fechaInicio, diasSiguienteCuota, numCuotas) {
  const n = Math.max(1, parseInt(numCuotas, 10) || 1);
  const inicio = fechaInicio || new Date().toISOString().slice(0, 10);
  const intervalo = normalizeDiasSiguienteCuota(diasSiguienteCuota);
  const dates = [inicio];
  for (let i = 1; i < n; i++) {
    dates.push(addDays(dates[i - 1], intervalo));
  }
  return dates;
}

function buildCuotasPlan({ precio, sesiones, diasSiguienteCuota, fechaInicio, numCuotas, tipoPago }) {
  const esParcial = tipoPago === 'parcial';
  const n = esParcial ? Math.max(2, parseInt(numCuotas, 10) || 2) : 1;
  const amounts = distributeAmount(precio, n);
  const sessionBlocks = distributeSessions(sesiones, n);
  const dates = distributePaymentDates(fechaInicio, diasSiguienteCuota, n);

  return amounts.map((monto, i) => ({
    numero: i + 1,
    monto,
    fecha_pago: dates[i],
    sesiones_inicio: sessionBlocks[i].sesiones_inicio,
    sesiones_fin: sessionBlocks[i].sesiones_fin,
    pagado: esParcial ? 0 : 1,
  }));
}

module.exports = {
  MIN_DIAS_SIGUIENTE_CUOTA,
  normalizeDiasSiguienteCuota,
  distributeAmount,
  distributeSessions,
  distributePaymentDates,
  buildCuotasPlan,
};
