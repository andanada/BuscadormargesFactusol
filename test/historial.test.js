import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Historial } from '../src/historial.js';

const tmp = async () => join(await mkdtemp(join(tmpdir(), 'hist-')), 'historial.jsonl');

test('el historial sobrevive a una línea cortada y conserva el resto', async () => {
  const ruta = await tmp();
  const ok = { evento: 'cambio', id: 'a', fecha: '2026-10-27T10:00:00Z', codart: '1', estado: 'pendiente' };
  await writeFile(ruta, `${JSON.stringify(ok)}\n{"evento":"cambio","id":"b","fec`, 'utf8');
  const h = new Historial(ruta);
  await h.cargar();
  assert.equal(h.lista().length, 1);
  assert.equal(h.obtener('a').estado, 'pendiente');
});

test('los cambios de estado y deshacer se reconstruyen al recargar', async () => {
  const ruta = await tmp();
  const h = new Historial(ruta);
  await h.cargar();
  const { id } = await h.registrar({ codart: '1', estado: 'pendiente' });
  await h.actualizarEstado(id, 'aplicado');
  await h.marcarDeshecho(id);
  const h2 = new Historial(ruta);
  await h2.cargar();
  assert.equal(h2.obtener(id).estado, 'deshecho');
  assert.equal((await readFile(ruta, 'utf8')).trim().split('\n').length, 3); // solo se añade, nunca se reescribe
});
