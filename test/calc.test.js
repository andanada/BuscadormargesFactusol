import test from 'node:test';
import assert from 'node:assert/strict';
import { costeNeto, margenReal, pctIva, pvpAlmacenadoParaMargen, pvpSinIva, tramoDe } from '../src/calc.js';

test('costeNeto aplica los descuentos de compra en cadena', () => {
  assert.equal(costeNeto(605.03, [50]), 302.515);
  assert.equal(costeNeto(100, [10, 10]), 81);
  assert.equal(costeNeto(100, []), 100);
  assert.equal(costeNeto(100, [0, 0, 0]), 100);
});

test('el 617253 (dto 50 %) tiene margen 35 % sobre el coste neto, no negativo', () => {
  const neto = costeNeto(605.03, [50]);
  assert.ok(Math.abs(margenReal(neto, 408.3953, false, 21) - 35) < 0.01);
});

test('tramoDe: bordes y redondeo de PVP con 4 decimales', () => {
  assert.equal(tramoDe(-18), 'negativo');
  assert.equal(tramoDe(0), '0-10');
  assert.equal(tramoDe(9.9999), '10-15'); // 9,9999 % es un margen objetivo del 10 %
  assert.equal(tramoDe(10), '10-15');
  assert.equal(tramoDe(14.99), '10-15');
  assert.equal(tramoDe(15), '15-20');
  assert.equal(tramoDe(19.9999), null); // es un 20 % exacto
  assert.equal(tramoDe(35), null);
  assert.equal(tramoDe(-0.001), '0-10');
});

test('IVA: tipos conocidos y desconocido', () => {
  assert.equal(pctIva(0), 21);
  assert.equal(pctIva(1), 10);
  assert.equal(pctIva(2), 4);
  assert.equal(pctIva(3), 0);
  assert.equal(pctIva(9), null);
});

test('PVP de una tarifa con IVA incluido y sin IVA', () => {
  assert.equal(pvpAlmacenadoParaMargen(161.4, 20, false, 21), 193.68);
  assert.equal(pvpAlmacenadoParaMargen(100, 20, true, 21), 145.2); // 120 sin IVA * 1,21
  assert.equal(pvpSinIva(145.2, true, 21), 120);
  assert.equal(pvpSinIva(120, false, 21), 120);
  assert.ok(Math.abs(margenReal(100, 145.2, true, 21) - 20) < 0.001);
});
