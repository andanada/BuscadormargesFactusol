import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardarCopia } from '../src/copias.js';

const datos = (n) => ({
  cargadoEn: new Date(Date.UTC(2026, 9, 27, 12, 0, n)).toISOString(),
  lineas: [{ ARTLTA: '3342', TARLTA: 2, MARLTA: -18, PRELTA: 132.348, OTRO: 'no se guarda' }],
});

test('guarda las líneas de tarifa tal cual estaban (solo las 4 columnas relevantes)', async () => {
  const carpeta = await mkdtemp(join(tmpdir(), 'copias-'));
  const archivo = await guardarCopia(carpeta, datos(0), '2026');
  const c = JSON.parse(await readFile(archivo, 'utf8'));
  assert.deepEqual(c.lineas, [{ ARTLTA: '3342', TARLTA: 2, MARLTA: -18, PRELTA: 132.348 }]);
  assert.equal(c.ejercicio, '2026');
});

test('conserva solo las últimas N copias', async () => {
  const carpeta = await mkdtemp(join(tmpdir(), 'copias-'));
  for (let i = 0; i < 6; i++) await guardarCopia(carpeta, datos(i), '2026', 3);
  const quedan = await readdir(carpeta);
  assert.equal(quedan.length, 3);
  assert.ok(quedan.every((f) => /(03|04|05)/.test(f.slice(-9)) || f.includes('12-00-0')));
});
