import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorDeEscritura, ErrorDeValidacion, ErrorDeVerificacion, aplicarMargen, aplicarPrecio, deshacer } from '../src/margenes.js';

// Misma simulación de FactuSOL que margenes.test.js, reducida a lo que usa el modo precio.
function crearFactusol({ lineas, escritura = 'ok' }) {
  const escrituras = [];
  const articulos = [{ CODART: '3342', DESART: 'Balastro', PCOART: 161.4, DT0ART: 0, DT1ART: 0, DT2ART: 0, TIVART: 0, REFART: '' }];
  const tarifas = [
    { CODTAR: 1, DESTAR: 'Tarifa 1', IVATAR: 1 },
    { CODTAR: 2, DESTAR: 'Tarifa Associaciones', IVATAR: 0 },
  ];
  const linea = (cod, t) => lineas.find((l) => l.ARTLTA === cod && l.TARLTA === t);
  return {
    escrituras,
    async cargaTabla(tabla, filtro) {
      if (tabla === 'F_ART') return articulos.map((a) => ({ ...a }));
      if (tabla === 'F_LTA') {
        const m = /ARTLTA = '(.*)' AND TARLTA = (\d+)/.exec(filtro);
        return lineas.filter((l) => l.ARTLTA === m[1] && l.TARLTA === Number(m[2])).map((l) => ({ ...l }));
      }
      return tarifas.filter((t) => t.CODTAR === Number(/CODTAR = (\d+)/.exec(filtro)[1])).map((t) => ({ ...t }));
    },
    async actualizarPrecioLinea(codart, tarifa, prelta) {
      escrituras.push({ tipo: 'precio', codart, tarifa, prelta });
      if (escritura === 'falla') throw new Error('timeout');
      if (escritura !== 'ignora') linea(codart, tarifa).PRELTA = prelta;
    },
    async actualizarLineaTarifa(codart, tarifa, marlta, prelta) {
      escrituras.push({ tipo: 'margen', codart, tarifa, marlta, prelta });
      Object.assign(linea(codart, tarifa), { MARLTA: marlta, PRELTA: prelta });
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

const lineas = () => [
  { TARLTA: 1, ARTLTA: '3342', MARLTA: 0, PRELTA: 199 },
  { TARLTA: 2, ARTLTA: '3342', MARLTA: 20, PRELTA: 193.68 },
];
const SOL = { codart: '3342', tarifa: 1, pvpAntesEsperado: 199, pvpNuevo: 234 };
const cfg = { esperaMs: 1, tarifasEscribibles: new Set([1, 2]), tarifasPorPrecio: new Set([1]) };
const precio = (delsol, historial, solicitud = SOL, extra = {}) => aplicarPrecio({ delsol, historial, solicitud, ...cfg, ...extra });

test('escribe SOLO el PVP, no toca MARLTA, y devuelve el margen real resultante', async () => {
  const l = lineas();
  const delsol = crearFactusol({ lineas: l });
  const historial = historialFalso();
  const r = await precio(delsol, historial);
  assert.deepEqual(delsol.escrituras, [{ tipo: 'precio', codart: '3342', tarifa: 1, prelta: 234 }]);
  assert.equal(l[0].MARLTA, 0);
  assert.equal(r.margenAntes, 1.9); // 199 con IVA = 164,46 sin IVA sobre coste 161,40
  assert.equal(r.margenReal, 19.82); // 234 / 1,21 = 193,39 sin IVA
  assert.equal(historial.cambios.get(r.id).tipo, 'precio');
  assert.equal(historial.cambios.get(r.id).estado, 'aplicado');
});

test('cada tarifa se edita solo con su modo: precio en la 1, margen en la 2', async () => {
  const delsol = crearFactusol({ lineas: lineas() });
  await assert.rejects(precio(delsol, historialFalso(), { ...SOL, tarifa: 2, pvpAntesEsperado: 193.68 }), /se edita con el margen/);
  await assert.rejects(
    aplicarMargen({ delsol, historial: historialFalso(), solicitud: { codart: '3342', tarifa: 1, pvpAntesEsperado: 199, pvpNuevoEsperado: 234.35, nuevoMargen: 20 }, ...cfg }),
    /se edita con el precio directo/,
  );
  assert.equal(delsol.escrituras.length, 0);
});

test('rechaza precios inválidos, con más de 2 decimales o saltos x3', async () => {
  const delsol = crearFactusol({ lineas: lineas() });
  for (const pvpNuevo of [0, -5, NaN, Infinity, 100001]) {
    await assert.rejects(precio(delsol, historialFalso(), { ...SOL, pvpNuevo }), ErrorDeValidacion);
  }
  await assert.rejects(precio(delsol, historialFalso(), { ...SOL, pvpNuevo: 234.567 }), /2 decimales/);
  await assert.rejects(precio(delsol, historialFalso(), { ...SOL, pvpNuevo: 23.4 }), /Parece un error/); // 234 tecleado como 23,4
  assert.equal(delsol.escrituras.length, 0);
});

test('rechaza si el PVP actual cambió desde que el usuario lo vio', async () => {
  const delsol = crearFactusol({ lineas: lineas() });
  await assert.rejects(precio(delsol, historialFalso(), { ...SOL, pvpAntesEsperado: 180 }), /ya no es 180/);
  assert.equal(delsol.escrituras.length, 0);
});

test('una línea sin precio (PVP 0) se puede tarifar directamente', async () => {
  const l = lineas();
  l[0].PRELTA = 0;
  const delsol = crearFactusol({ lineas: l });
  await precio(delsol, historialFalso(), { ...SOL, pvpAntesEsperado: 0 });
  assert.equal(l[0].PRELTA, 234);
});

test('relectura que no coincide: estado incierto; timeout sin aplicar: no_aplicado', async () => {
  const h1 = historialFalso();
  await assert.rejects(precio(crearFactusol({ lineas: lineas(), escritura: 'ignora' }), h1), ErrorDeVerificacion);
  assert.equal([...h1.cambios.values()][0].estado, 'verificacion_fallida');
  const h2 = historialFalso();
  await assert.rejects(precio(crearFactusol({ lineas: lineas(), escritura: 'falla' }), h2), ErrorDeEscritura);
  assert.equal([...h2.cambios.values()][0].estado, 'no_aplicado');
});

test('deshacer un cambio de precio restaura solo el PVP, y no si alguien lo cambió después', async () => {
  const l = lineas();
  const delsol = crearFactusol({ lineas: l });
  const historial = historialFalso();
  const r = await precio(delsol, historial);
  l[0].PRELTA = 250; // lo toca otra persona
  await assert.rejects(deshacer({ delsol, historial, id: r.id, esperaMs: 1 }), /ya no está como lo dejó/);
  l[0].PRELTA = 234;
  await deshacer({ delsol, historial, id: r.id, esperaMs: 1 });
  assert.equal(l[0].PRELTA, 199);
  assert.equal(delsol.escrituras.at(-1).tipo, 'precio'); // no escribió MARLTA
  assert.equal(historial.cambios.get(r.id).estado, 'deshecho');
});
