// Servidor local (127.0.0.1) del panel de márgenes. Sin framework: http de Node.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { cargarConfig } from './config.js';
import { DelsolClient } from './delsol.js';
import { Historial } from './historial.js';
import { guardarCopia } from './copias.js';
import { ErrorDeValidacion, ErrorDeVerificacion, aplicarMargen, aplicarPrecio, cargarDatos, deshacer, listaPorTarifa } from './margenes.js';
import { TRAMOS } from './calc.js';

const config = cargarConfig();
const delsol = new DelsolClient({ creds: config.creds, ejercicio: config.ejercicio });
const historial = new Historial(config.rutaHistorial);
await historial.cargar();

let datos = null;
let cargando = null;
let cola = Promise.resolve(); // las escrituras van de una en una

const recargar = () =>
  (cargando ??= cargarDatos(delsol)
    .then(async (d) => {
      // Sin copia de seguridad no se escribe (ver /api/aplicar): leer sí se puede.
      d.copiaOk = await guardarCopia(config.rutaCopias, d, config.ejercicio).then(
        () => true,
        (err) => {
          console.warn('No se pudo guardar la copia de seguridad:', err.message);
          return false;
        },
      );
      datos = d;
      return d;
    })
    .finally(() => (cargando = null)));

const enCola = (tarea) => {
  const resultado = cola.then(tarea);
  cola = resultado.catch(() => {});
  return resultado;
};

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const ESTATICOS = new Set(['/', '/index.html', '/app.js', '/style.css']);
const HOSTS_OK = new Set([`127.0.0.1:${config.puerto}`, `localhost:${config.puerto}`]);

function responder(res, estado, cuerpo, tipo = 'application/json; charset=utf-8') {
  res.writeHead(estado, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof cuerpo === 'string' || Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo));
}

async function leerJson(req) {
  const trozos = [];
  let tamano = 0;
  for await (const trozo of req) {
    tamano += trozo.length;
    if (tamano > 10_000) throw new ErrorDeValidacion('Petición demasiado grande.');
    trozos.push(trozo);
  }
  try {
    return JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}');
  } catch {
    throw new ErrorDeValidacion('JSON no válido.');
  }
}

const tarifasDisponibles = () => [...datos.tarifas.values()].map(({ codigo, nombre, incluyeIva }) => ({ codigo, nombre, incluyeIva }));

async function manejar(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Defensa contra DNS rebinding y contra webs ajenas que intenten escribir en localhost.
  if (!HOSTS_OK.has(req.headers.host ?? '')) return responder(res, 403, { error: 'Host no permitido.' });
  if (req.method === 'POST' && (req.headers['x-margenes'] !== '1' || !String(req.headers['content-type']).startsWith('application/json'))) {
    return responder(res, 403, { error: 'Petición no permitida.' });
  }

  if (req.method === 'GET' && ESTATICOS.has(url.pathname)) {
    const archivo = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return responder(res, 200, await readFile(join(config.raiz, 'public', archivo)), TIPOS[extname(archivo)]);
  }
  if (url.pathname === '/favicon.ico') return responder(res, 204, '');
  if (!url.pathname.startsWith('/api/')) return responder(res, 404, { error: 'No existe.' });

  if (!datos) await recargar();

  if (req.method === 'GET' && url.pathname === '/api/lista') {
    const tarifa = Number(url.searchParams.get('tarifa') ?? 2);
    const { items, ...resto } = listaPorTarifa(datos, tarifa);
    const modo = config.tarifasPorPrecio.has(tarifa) ? 'precio' : 'margen'; // cómo se edita esta tarifa
    return responder(res, 200, { ...resto, ejercicio: config.ejercicio, escribible: config.tarifasEscribibles.has(tarifa), modo, cargadoEn: datos.cargadoEn, tramos: TRAMOS, tarifas: tarifasDisponibles(), items });
  }
  if (req.method === 'POST' && url.pathname === '/api/recargar') {
    await recargar();
    return responder(res, 200, { cargadoEn: datos.cargadoEn });
  }
  if (req.method === 'GET' && url.pathname === '/api/historial') {
    return responder(res, 200, { cambios: historial.lista() });
  }
  if (req.method === 'POST' && url.pathname === '/api/aplicar') {
    const cuerpo = await leerJson(req);
    if (!datos.copiaOk) throw new ErrorDeValidacion('No hay copia de seguridad de las tarifas: recarga los datos y revisa la consola del programa antes de escribir.');
    const resultado = await enCola(() =>
      aplicarMargen({ delsol, historial, solicitud: cuerpo, tarifasEscribibles: config.tarifasEscribibles, tarifasPorPrecio: config.tarifasPorPrecio }),
    );
    const linea = datos.lineas.find((l) => l.ARTLTA === resultado.codart && Number(l.TARLTA) === resultado.tarifa);
    if (linea) Object.assign(linea, { MARLTA: resultado.despues.marlta, PRELTA: resultado.despues.prelta });
    return responder(res, 200, resultado);
  }
  if (req.method === 'POST' && url.pathname === '/api/aplicar-precio') {
    const cuerpo = await leerJson(req);
    if (!datos.copiaOk) throw new ErrorDeValidacion('No hay copia de seguridad de las tarifas: recarga los datos y revisa la consola del programa antes de escribir.');
    const resultado = await enCola(() =>
      aplicarPrecio({ delsol, historial, solicitud: cuerpo, tarifasEscribibles: config.tarifasEscribibles, tarifasPorPrecio: config.tarifasPorPrecio }),
    );
    const linea = datos.lineas.find((l) => l.ARTLTA === resultado.codart && Number(l.TARLTA) === resultado.tarifa);
    if (linea) linea.PRELTA = resultado.despues.prelta; // MARLTA no se toca
    return responder(res, 200, resultado);
  }
  if (req.method === 'POST' && url.pathname === '/api/deshacer') {
    const { id } = await leerJson(req);
    const resultado = await enCola(() => deshacer({ delsol, historial, id }));
    const linea = datos.lineas.find((l) => l.ARTLTA === resultado.codart && Number(l.TARLTA) === resultado.tarifa);
    if (linea) Object.assign(linea, { MARLTA: resultado.restaurado.marlta, PRELTA: resultado.restaurado.prelta });
    return responder(res, 200, resultado);
  }
  return responder(res, 404, { error: 'No existe.' });
}

createServer((req, res) => {
  manejar(req, res).catch((err) => {
    if (err instanceof ErrorDeValidacion) return responder(res, 400, { error: err.message });
    if (err instanceof ErrorDeVerificacion) return responder(res, 500, { error: err.message, verificacion: true });
    console.error('Error no controlado:', err);
    responder(res, 500, { error: 'Error interno. Mira la consola del programa.' });
  });
}).listen(config.puerto, '127.0.0.1', () => {
  process.stdout.write(`Panel de márgenes: http://127.0.0.1:${config.puerto}  (credenciales de ${config.rutaEnv})\n`);
});
