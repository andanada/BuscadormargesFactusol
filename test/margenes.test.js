import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorDeEscritura, ErrorDeValidacion, ErrorDeVerificacion, aplicarMargen, aplicarPrecio, deshacer, listaPorTarifa, sumarStock } from '../src/margenes.js';
import { pvpAlmacenadoParaMargen } from '../src/calc.js';

// FactuSOL simulado en memoria: mismas tablas y columnas que la API real.
// `escritura`: 'ok' aplica; 'ignora' no aplica y no falla; 'falla' lanza sin aplicar;
// 'aplica-y-falla' aplica pero lanza (timeout con resultado incierto).
function crearFactusol({ articulos, lineas, tarifas, escritura = 'ok' }) {
  const escrituras = [];
  return {
    escrituras,
    async cargaTabla(tabla, filtro) {
      if (tabla === 'F_ART') {
        const cod = /CODART = '(.*)'/.exec(filtro)?.[1];
        return articulos.filter((a) => cod === undefined || a.CODART === cod).map((a) => ({ ...a }));
      }
      if (tabla === 'F_LTA') {
        const m = /ARTLTA = '(.*)' AND TARLTA = (\d+)/.exec(filtro);
        return lineas.filter((l) => !m || (l.ARTLTA === m[1] && l.TARLTA === Number(m[2]))).map((l) => ({ ...l }));
      }
      const cod = /CODTAR = (\d+)/.exec(filtro)?.[1];
      return tarifas.filter((t) => cod === undefined || t.CODTAR === Number(cod)).map((t) => ({ ...t }));
    },
    async actualizarLineaTarifa(codart, tarifa, marlta, prelta) {
      escrituras.push({ codart, tarifa, marlta, prelta });
      if (escritura === 'falla') throw new Error('timeout');
      if (escritura !== 'ignora') Object.assign(lineas.find((l) => l.ARTLTA === codart && l.TARLTA === tarifa), { MARLTA: marlta, PRELTA: prelta });
      if (escritura === 'aplica-y-falla') throw new Error('timeout');
    },
    async actualizarPrecioLinea(codart, tarifa, prelta) {
      escrituras.push({ codart, tarifa, prelta, soloPrecio: true });
      if (escritura === 'falla') throw new Error('timeout');
      if (escritura !== 'ignora') Object.assign(lineas.find((l) => l.ARTLTA === codart && l.TARLTA === tarifa), { PRELTA: prelta });
      if (escritura === 'aplica-y-falla') throw new Error('timeout');
    },
  };
}

const historialFalso = () => {
  const cambios = new Map();
  return {
    async registrar(d) {
      const r = { id: `id${cambios.size + 1}`, ...d };
      cambios.set(r.id, r);
      return r;
    },
    obtener: (id) => cambios.get(id),
    async actualizarEstado(id, estado) {
      cambios.set(id, { ...cambios.get(id), estado });
    },
    async marcarDeshecho(id) {
      cambios.set(id, { ...cambios.get(id), estado: 'deshecho' });
    },
    cambios,
  };
};

const escenario = (extra = {}) => ({
  articulos: [
    { CODART: '3342', DESART: 'Balastro', PCOART: 161.4, DT0ART: 0, DT1ART: 0, DT2ART: 0, TIVART: 0, REFART: 'Descatalogado - 1' },
    { CODART: '617253', DESART: 'Sistema Vega', PCOART: 605.03, DT0ART: 50, DT1ART: 0, DT2ART: 0, TIVART: 0, REFART: '617253' },
  ],
  lineas: [
    { TARLTA: 2, ARTLTA: '3342', MARLTA: -18, PRELTA: 132.348 },
    { TARLTA: 1, ARTLTA: '3342', MARLTA: 0, PRELTA: 199 },
    { TARLTA: 2, ARTLTA: '617253', MARLTA: 35, PRELTA: 408.3953 },
  ],
  tarifas: [
    { CODTAR: 1, DESTAR: 'Tarifa 1', IVATAR: 1 },
    { CODTAR: 2, DESTAR: 'Tarifa Associaciones', IVATAR: 0 },
  ],
  ...extra,
});

const cargado = (e) => ({
  articulos: new Map(e.articulos.map((a) => [a.CODART, a])),
  lineas: e.lineas,
  tarifas: new Map(e.tarifas.map((t) => [t.CODTAR, { codigo: t.CODTAR, nombre: t.DESTAR, incluyeIva: t.IVATAR === 1 }])),
});

const SOL = { codart: '3342', tarifa: 2, pvpAntesEsperado: 132.348, pvpNuevoEsperado: 193.68, nuevoMargen: 20 };
const aplicar = (delsol, historial, solicitud = SOL, tarifasEscribibles = new Set([1, 2])) =>
  aplicarMargen({ delsol, historial, esperaMs: 1, solicitud, tarifasEscribibles });

test('una tarifa que no está autorizada para escribir se rechaza antes de tocar nada', async () => {
  const delsol = crearFactusol(escenario());
  await assert.rejects(aplicar(delsol, historialFalso(), SOL, new Set([1])), /solo lectura/);
  await assert.rejects(aplicarMargen({ delsol, historial: historialFalso(), solicitud: SOL }), /solo lectura/); // sin lista = nada escribible
  assert.equal(delsol.escrituras.length, 0);
});

test('sumarStock suma todos los almacenes (disponible y actual) por artículo', () => {
  const s = sumarStock([
    { ARTSTO: 'A', ALMSTO: 'GEN', ACTSTO: 5, DISSTO: 4 },
    { ARTSTO: 'A', ALMSTO: 'ALM2', ACTSTO: 2.5, DISSTO: 2.5 },
    { ARTSTO: 'B', ALMSTO: 'GEN', ACTSTO: 0, DISSTO: -1 },
  ]);
  assert.deepEqual(s.get('A'), { disponible: 6.5, actual: 7.5, almacenes: 2 });
  assert.equal(s.get('B').disponible, -1);
  assert.equal(s.get('C'), undefined);
});

test('listaPorTarifa lleva el stock del artículo (o null si no tiene filas en F_STO)', () => {
  const datos = { ...cargado(escenario()), stock: sumarStock([{ ARTSTO: '3342', ALMSTO: 'GEN', ACTSTO: 3, DISSTO: 3 }]) };
  const r = listaPorTarifa(datos, 1);
  assert.deepEqual(r.items.find((i) => i.codart === '3342').stock, { disponible: 3, actual: 3, almacenes: 1 });
  assert.equal(listaPorTarifa(cargado(escenario()), 2).items[0].stock, null);
});

test('cada fila lleva el margen real de las otras tarifas del mismo artículo', () => {
  const r2 = listaPorTarifa(cargado(escenario()), 2);
  assert.deepEqual(r2.items[0].otras, [{ codigo: 1, nombre: 'Tarifa 1', margenReal: 1.9, pvpAlmacenado: 199 }]); // 199 con IVA = 164,46 sin IVA
  const r1 = listaPorTarifa(cargado(escenario()), 1);
  const o = r1.items.find((i) => i.codart === '3342').otras;
  assert.equal(o.length, 1);
  assert.equal(o[0].codigo, 2);
  assert.equal(o[0].margenReal, -18);
});

test('listaPorTarifa usa el coste neto: el 617253 no sale como negativo', () => {
  const r = listaPorTarifa(cargado(escenario()), 2);
  assert.equal(r.conteo.negativo, 1);
  assert.deepEqual(r.items.map((i) => i.codart), ['3342']);
  assert.equal(r.items[0].descatalogado, true);
  assert.equal(r.evaluados, 2);
});

test('aplicarMargen escribe margen y PVP, verifica y deja historial', async () => {
  const delsol = crearFactusol(escenario());
  const historial = historialFalso();
  const r = await aplicar(delsol, historial);
  assert.deepEqual(delsol.escrituras, [{ codart: '3342', tarifa: 2, marlta: 20, prelta: 193.68 }]);
  assert.equal(r.margenReal, 20);
  assert.equal(historial.cambios.get(r.id).estado, 'aplicado');
  assert.deepEqual(historial.cambios.get(r.id).antes, { marlta: -18, prelta: 132.348 });
});

test('en tarifa con IVA escribe el PVP con IVA', async () => {
  const delsol = crearFactusol(escenario());
  await aplicar(delsol, historialFalso(), { codart: '3342', tarifa: 1, pvpAntesEsperado: 199, pvpNuevoEsperado: 234.35, nuevoMargen: 20 });
  assert.equal(delsol.escrituras[0].prelta, 234.35); // 161,4*1,2 = 193,68 * 1,21
});

test('rechaza si el PVP actual cambió desde que el usuario lo vio (no escribe)', async () => {
  const delsol = crearFactusol(escenario());
  await assert.rejects(aplicar(delsol, historialFalso(), { ...SOL, pvpAntesEsperado: 150 }), /ya no es 150/);
  assert.equal(delsol.escrituras.length, 0);
});

test('rechaza si el coste cambió y el PVP nuevo ya no es el confirmado (no escribe)', async () => {
  const e = escenario();
  e.articulos[0].PCOART = 200; // el coste sube después de cargar la lista
  const delsol = crearFactusol(e);
  await assert.rejects(aplicar(delsol, historialFalso()), /coste de 3342 ha cambiado/);
  assert.equal(delsol.escrituras.length, 0);
});

test('rechaza márgenes inválidos, CODART raro y saltos x3 sin forzar', async () => {
  const delsol = crearFactusol(escenario());
  for (const nuevoMargen of [-1, 501, NaN, Infinity]) {
    await assert.rejects(aplicar(delsol, historialFalso(), { ...SOL, nuevoMargen }), ErrorDeValidacion);
  }
  await assert.rejects(aplicar(delsol, historialFalso(), { ...SOL, codart: "x' OR '1'='1;" }), /CODART no válido/);
  await assert.rejects(aplicar(delsol, historialFalso(), { ...SOL, pvpNuevoEsperado: undefined }), /Faltan los PVP/);
  await assert.rejects(aplicar(delsol, historialFalso(), { ...SOL, nuevoMargen: 300, pvpNuevoEsperado: pvpAlmacenadoParaMargen(161.4, 300, false, 21) }), /Parece un error/);
  assert.equal(delsol.escrituras.length, 0);
});

test('una línea sin precio (PVP 0) se puede tarifar: no hay referencia para el límite x3', async () => {
  const e = escenario();
  e.lineas.find((l) => l.ARTLTA === '3342' && l.TARLTA === 2).PRELTA = 0;
  const delsol = crearFactusol(e);
  await aplicar(delsol, historialFalso(), { ...SOL, pvpAntesEsperado: 0 });
  assert.equal(delsol.escrituras[0].prelta, 193.68);
});

test('el margen se redondea a 2 decimales antes de escribir', async () => {
  const delsol = crearFactusol(escenario());
  await aplicar(delsol, historialFalso(), { ...SOL, nuevoMargen: 20.004, pvpNuevoEsperado: 193.68 });
  assert.equal(delsol.escrituras[0].marlta, 20);
});

test('el PVP se redondea hacia arriba: el margen nunca queda por debajo del pedido', () => {
  assert.equal(pvpAlmacenadoParaMargen(0.12, 20, false, 21), 0.15); // 0,144 -> 0,15 (no 0,14 = 16,7 %)
  assert.equal(pvpAlmacenadoParaMargen(161.4, 20, false, 21), 193.68); // exacto: no sube un céntimo
});

test('si la relectura no coincide: estado incierto, historial y ErrorDeVerificacion', async () => {
  const delsol = crearFactusol(escenario({ escritura: 'ignora' }));
  const historial = historialFalso();
  await assert.rejects(aplicar(delsol, historial), ErrorDeVerificacion);
  assert.equal([...historial.cambios.values()][0].estado, 'verificacion_fallida');
});

test('timeout en la escritura que NO llegó a aplicarse: no_aplicado, y el snapshot ya estaba guardado', async () => {
  const delsol = crearFactusol(escenario({ escritura: 'falla' }));
  const historial = historialFalso();
  await assert.rejects(aplicar(delsol, historial), ErrorDeEscritura);
  const [reg] = [...historial.cambios.values()];
  assert.equal(reg.estado, 'no_aplicado');
  assert.deepEqual(reg.antes, { marlta: -18, prelta: 132.348 });
});

test('timeout en la escritura que SÍ se aplicó: se detecta por la relectura y cuenta como aplicado', async () => {
  const delsol = crearFactusol(escenario({ escritura: 'aplica-y-falla' }));
  const historial = historialFalso();
  const r = await aplicar(delsol, historial);
  assert.equal(historial.cambios.get(r.id).estado, 'aplicado');
});

test('deshacer restaura el valor anterior y se niega si alguien lo cambió después', async () => {
  const e = escenario();
  const delsol = crearFactusol(e);
  const historial = historialFalso();
  const r = await aplicar(delsol, historial);
  e.lineas[0].PRELTA = 250; // alguien lo toca en FactuSOL
  await assert.rejects(deshacer({ delsol, historial, id: r.id, esperaMs: 1 }), /ya no está como lo dejó/);
  e.lineas[0].PRELTA = 193.68;
  await deshacer({ delsol, historial, id: r.id, esperaMs: 1 });
  assert.deepEqual({ m: e.lineas[0].MARLTA, p: e.lineas[0].PRELTA }, { m: -18, p: 132.348 });
  assert.equal(historial.cambios.get(r.id).estado, 'deshecho');
  await assert.rejects(deshacer({ delsol, historial, id: r.id, esperaMs: 1 }), ErrorDeValidacion);
});

test('un cambio en estado incierto también se puede deshacer', async () => {
  const e = escenario({ escritura: 'ok' });
  const delsol = crearFactusol(e);
  const historial = historialFalso();
  const r = await aplicar(delsol, historial);
  await historial.actualizarEstado(r.id, 'verificacion_fallida');
  await deshacer({ delsol, historial, id: r.id, esperaMs: 1 });
  assert.equal(e.lineas[0].PRELTA, 132.348);
  assert.equal(historial.cambios.get(r.id).estado, 'deshecho');
});

test('deshacer un cambio que nunca llegó a aplicarse no escribe nada y lo marca deshecho', async () => {
  const delsol = crearFactusol(escenario({ escritura: 'falla' }));
  const historial = historialFalso();
  await assert.rejects(aplicar(delsol, historial), ErrorDeEscritura);
  const id = [...historial.cambios.keys()][0];
  await historial.actualizarEstado(id, 'pendiente'); // p. ej. el proceso murió antes de resolverlo
  const antesEscrituras = delsol.escrituras.length;
  await deshacer({ delsol, historial, id, esperaMs: 1 });
  assert.equal(delsol.escrituras.length, antesEscrituras);
  assert.equal(historial.cambios.get(id).estado, 'deshecho');
});
