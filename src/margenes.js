// Lista de márgenes por debajo del 20 % y escritura segura de un nuevo margen.
import { costeNeto, margenReal, pctIva, pvpAlmacenadoParaMargen, pvpSinIva, tramoDe, TRAMOS } from './calc.js';

export class ErrorDeValidacion extends Error {}
export class ErrorDeVerificacion extends Error {}
/** La escritura falló pero se comprobó que FactuSOL sigue con el valor anterior. Corta la tanda igual. */
export class ErrorDeEscritura extends ErrorDeVerificacion {}

const CODART_VALIDO = /^[\w.\-/ ]{1,30}$/;
const MARGEN_MAX = 500;
const ESTADOS_DESHACIBLES = new Set(['aplicado', 'verificacion_fallida', 'pendiente']);
const RATIO_MAX_PVP = 3; // subir o bajar un PVP más de x3 exige confirmación explícita (forzar)
const redondea2 = (n) => Math.round(n * 100) / 100;
const cerca = (a, b) => Math.abs(a - b) < 0.005;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function filtroCodart(codart) {
  if (typeof codart !== 'string' || !CODART_VALIDO.test(codart)) throw new ErrorDeValidacion('CODART no válido.');
  return `CODART = '${codart.replace(/'/g, "''")}'`;
}

/** Descarga artículos, líneas de tarifa y configuración de tarifas de FactuSOL. */
export async function cargarDatos(delsol) {
  const [articulos, lineas, tarifas, stocks] = await Promise.all([
    delsol.cargaTabla('F_ART', "CODART > ''"),
    delsol.cargaTabla('F_LTA', 'TARLTA > 0'),
    delsol.cargaTabla('F_TAR', 'CODTAR > 0'),
    delsol.cargaTabla('F_STO', "ARTSTO > ''"),
  ]);
  return {
    cargadoEn: new Date().toISOString(),
    articulos: new Map(articulos.map((a) => [a.CODART, a])),
    stock: sumarStock(stocks),
    lineas,
    tarifas: new Map(tarifas.map((t) => [Number(t.CODTAR), { codigo: Number(t.CODTAR), nombre: String(t.DESTAR), incluyeIva: Number(t.IVATAR) === 1 }])),
  };
}

/** El stock real vive en F_STO (una fila por artículo y almacén), no en F_ART.STOART (suele ser 0).
 * Se suman todos los almacenes: disponible (DISSTO) y actual (ACTSTO). */
export function sumarStock(filas) {
  const porArticulo = new Map();
  for (const f of filas) {
    const previo = porArticulo.get(f.ARTSTO) ?? { disponible: 0, actual: 0, almacenes: 0 };
    porArticulo.set(f.ARTSTO, {
      disponible: previo.disponible + (Number(f.DISSTO) || 0),
      actual: previo.actual + (Number(f.ACTSTO) || 0),
      almacenes: previo.almacenes + 1,
    });
  }
  for (const s of porArticulo.values()) {
    s.disponible = Math.round(s.disponible * 1000) / 1000;
    s.actual = Math.round(s.actual * 1000) / 1000;
  }
  return porArticulo;
}

function descuentosDe(a) {
  return [a.DT0ART, a.DT1ART, a.DT2ART].map(Number);
}

/** Construye la fila de la lista para una línea de tarifa, o null si no es calculable. */
export function construirItem(linea, articulo, tarifa, stock = null) {
  if (!articulo) return { descartado: 'sin_articulo' };
  const bruto = Number(articulo.PCOART);
  if (!(bruto > 0)) return { descartado: 'sin_coste' };
  const ivaPct = pctIva(Number(articulo.TIVART));
  if (tarifa.incluyeIva && ivaPct === null) return { descartado: 'iva_desconocido' };
  const neto = costeNeto(bruto, descuentosDe(articulo));
  if (!(neto > 0)) return { descartado: 'sin_coste' };
  const pvp = Number(linea.PRELTA);
  const real = margenReal(neto, pvp, tarifa.incluyeIva, ivaPct ?? 0);
  return {
    item: {
      codart: String(articulo.CODART),
      desart: String(articulo.DESART ?? '').trim(),
      tarifa: Number(linea.TARLTA),
      costeBruto: bruto,
      descuentos: descuentosDe(articulo),
      costeNeto: Math.round(neto * 10000) / 10000,
      pvpAlmacenado: pvp,
      pvpSinIva: pvpSinIva(pvp, tarifa.incluyeIva, ivaPct ?? 0),
      incluyeIva: tarifa.incluyeIva,
      ivaPct: ivaPct ?? 0,
      margenReal: Math.round(real * 100) / 100,
      margenConfigurado: Number(linea.MARLTA),
      tramo: tramoDe(real),
      stock, // { disponible, actual, almacenes } o null si el artículo no tiene filas en F_STO
      descatalogado: /descatalogad/i.test(String(articulo.REFART ?? '')),
      multiDescuento: descuentosDe(articulo).filter((d) => d > 0).length > 1,
    },
  };
}

/** Todos los artículos de una tarifa con margen real < 20 %, ordenados del peor al mejor. */
export function listaPorTarifa(datos, tarifaCodigo) {
  const tarifa = datos.tarifas.get(tarifaCodigo);
  if (!tarifa) throw new ErrorDeValidacion(`La tarifa ${tarifaCodigo} no existe.`);
  const descartados = { sin_articulo: 0, sin_coste: 0, iva_desconocido: 0 };
  const items = [];
  let evaluados = 0;
  const lineaDe = new Map(datos.lineas.map((l) => [`${l.ARTLTA}|${Number(l.TARLTA)}`, l]));
  const otrasTarifas = [...datos.tarifas.values()].filter((t) => t.codigo !== tarifaCodigo);
  for (const linea of datos.lineas) {
    if (Number(linea.TARLTA) !== tarifaCodigo) continue;
    const articulo = datos.articulos.get(linea.ARTLTA);
    const { item, descartado } = construirItem(linea, articulo, tarifa, datos.stock?.get(linea.ARTLTA) ?? null);
    if (descartado) {
      descartados[descartado]++;
      continue;
    }
    evaluados++;
    if (!item.tramo) continue;
    // Margen de las demás tarifas del mismo artículo: solo informativo, para ver las dos a la vez.
    item.otras = otrasTarifas.flatMap((t) => {
      const otraLinea = lineaDe.get(`${linea.ARTLTA}|${t.codigo}`);
      const otro = otraLinea && construirItem(otraLinea, articulo, t).item;
      return otro ? [{ codigo: t.codigo, nombre: t.nombre, margenReal: otro.margenReal, pvpAlmacenado: otro.pvpAlmacenado }] : [];
    });
    items.push(item);
  }
  items.sort((a, b) => a.margenReal - b.margenReal);
  const conteo = Object.fromEntries(TRAMOS.map((t) => [t.id, items.filter((i) => i.tramo === t.id).length]));
  return { tarifa, evaluados, descartados, conteo, items };
}

/**
 * Aplica un nuevo margen a UNA línea de tarifa. Pasos: validar, releer en fresco, comprobar que
 * lo que vio el usuario sigue siendo cierto, escribir, releer para verificar y dejar historial.
 */
export async function aplicarMargen({ delsol, historial, solicitud, esperaMs = 600, tarifasEscribibles = new Set() }) {
  const { codart, tarifa, pvpAntesEsperado, pvpNuevoEsperado, nuevoMargen: margenPedido, forzar = false } = solicitud;
  if (!Number.isInteger(tarifa) || tarifa < 1) throw new ErrorDeValidacion('Tarifa no válida.');
  if (!tarifasEscribibles.has(tarifa)) {
    throw new ErrorDeValidacion(`La tarifa ${tarifa} está en solo lectura en este programa. Autorízala con TARIFAS_ESCRIBIBLES si de verdad quieres editarla.`);
  }
  if (!Number.isFinite(margenPedido) || margenPedido < 0 || margenPedido > MARGEN_MAX) {
    throw new ErrorDeValidacion(`El margen debe estar entre 0 y ${MARGEN_MAX} %.`);
  }
  if (!Number.isFinite(pvpAntesEsperado) || !Number.isFinite(pvpNuevoEsperado)) {
    throw new ErrorDeValidacion('Faltan los PVP que viste en pantalla (actual y nuevo).');
  }
  const nuevoMargen = redondea2(margenPedido); // FactuSOL guarda el margen con 2 decimales

  const [articulos, lineas, tarifas] = await Promise.all([
    delsol.cargaTabla('F_ART', filtroCodart(codart)),
    delsol.cargaTabla('F_LTA', `ARTLTA = '${codart.replace(/'/g, "''")}' AND TARLTA = ${tarifa}`),
    delsol.cargaTabla('F_TAR', `CODTAR = ${tarifa}`),
  ]);
  const articulo = articulos[0];
  const linea = lineas[0];
  if (!articulo) throw new ErrorDeValidacion(`El artículo ${codart} no existe en FactuSOL.`);
  if (!linea || !tarifas[0]) throw new ErrorDeValidacion(`El artículo ${codart} no tiene línea en la tarifa ${tarifa}.`);

  const cfg = { incluyeIva: Number(tarifas[0].IVATAR) === 1 };
  const { item, descartado } = construirItem(linea, articulo, cfg);
  if (descartado) throw new ErrorDeValidacion(`No se puede calcular el margen de ${codart} (${descartado}).`);
  if (!cerca(item.pvpAlmacenado, pvpAntesEsperado)) {
    throw new ErrorDeValidacion(
      `El PVP de ${codart} ya no es ${pvpAntesEsperado} en FactuSOL (ahora es ${item.pvpAlmacenado}). Recarga la lista antes de continuar.`,
    );
  }

  const pvpNuevo = pvpAlmacenadoParaMargen(item.costeNeto, nuevoMargen, cfg.incluyeIva, item.ivaPct);
  // Si el coste (o su descuento) cambió después de cargar la lista, el PVP que saldría ya no es
  // el que el usuario confirmó: no se escribe.
  if (!cerca(pvpNuevo, pvpNuevoEsperado)) {
    throw new ErrorDeValidacion(
      `El coste de ${codart} ha cambiado en FactuSOL: con ${nuevoMargen} % el PVP sería ${pvpNuevo}, no ${pvpNuevoEsperado}. Recarga la lista antes de continuar.`,
    );
  }
  const ratio = item.pvpAlmacenado > 0 ? pvpNuevo / item.pvpAlmacenado : Infinity;
  // Sin precio actual (PVP 0 = línea aún sin tarifar) no hay referencia contra la que medir un salto.
  if (!forzar && item.pvpAlmacenado > 0 && (ratio > RATIO_MAX_PVP || ratio < 1 / RATIO_MAX_PVP)) {
    throw new ErrorDeValidacion(
      `El cambio mueve el PVP de ${item.pvpAlmacenado} a ${pvpNuevo} (x${ratio.toFixed(1)}). Parece un error: confírmalo expresamente si es correcto.`,
    );
  }

  const antes = { marlta: item.margenConfigurado, prelta: item.pvpAlmacenado };
  const despues = { marlta: nuevoMargen, prelta: pvpNuevo };
  const base = { codart, desart: item.desart, tarifa, costeNeto: item.costeNeto, antes, despues };

  // El snapshot se guarda ANTES de escribir: si la escritura acaba en timeout o el proceso muere,
  // queda constancia de qué valores había y qué se intentó.
  const registro = await historial.registrar({ ...base, estado: 'pendiente' });

  let errorEscritura = null;
  try {
    await delsol.actualizarLineaTarifa(codart, tarifa, despues.marlta, despues.prelta);
  } catch (err) {
    errorEscritura = err; // puede haberse aplicado igualmente: se comprueba abajo
  }

  const filtroLinea = `ARTLTA = '${codart.replace(/'/g, "''")}' AND TARLTA = ${tarifa}`;
  const es = (l, v) => !!l && cerca(Number(l.PRELTA), v.prelta) && cerca(Number(l.MARLTA), v.marlta);
  let leida = null;
  let relecturaFallida = false;
  for (let i = 0; i < 5; i++) {
    if (i > 0) await dormir(esperaMs * 2 ** (i - 1));
    try {
      leida = (await delsol.cargaTabla('F_LTA', filtroLinea))[0];
      relecturaFallida = false;
    } catch {
      relecturaFallida = true;
      continue;
    }
    if (es(leida, despues)) break;
    if (errorEscritura && es(leida, antes)) break; // la escritura falló y no llegó a aplicarse
  }

  if (es(leida, despues)) {
    await historial.actualizarEstado(registro.id, 'aplicado');
    const nuevoReal = margenReal(item.costeNeto, pvpNuevo, cfg.incluyeIva, item.ivaPct);
    return { ...base, id: registro.id, margenReal: Math.round(nuevoReal * 100) / 100 };
  }
  if (errorEscritura && !relecturaFallida && es(leida, antes)) {
    await historial.actualizarEstado(registro.id, 'no_aplicado');
    throw new ErrorDeEscritura(`No se pudo escribir ${codart}: ${errorEscritura.message}. FactuSOL conserva el valor anterior.`);
  }
  await historial.actualizarEstado(registro.id, 'verificacion_fallida');
  throw new ErrorDeVerificacion(
    `No se sabe en qué estado quedó ${codart} (se intentó margen ${despues.marlta} %, PVP ${despues.prelta}). Revísalo en FactuSOL; en el Historial puedes deshacerlo.`,
  );
}

/** Deshace un cambio del historial, solo si la línea sigue como la dejó ese cambio. */
export async function deshacer({ delsol, historial, id, esperaMs = 600 }) {
  const registro = historial.obtener(id);
  if (!registro || !ESTADOS_DESHACIBLES.has(registro.estado)) throw new ErrorDeValidacion('Ese cambio no se puede deshacer.');
  const { codart, tarifa, antes, despues } = registro;
  const filtro = `ARTLTA = '${codart.replace(/'/g, "''")}' AND TARLTA = ${tarifa}`;
  const actual = (await delsol.cargaTabla('F_LTA', filtro))[0];
  const esValor = (v) => !!actual && cerca(Number(actual.PRELTA), v.prelta) && cerca(Number(actual.MARLTA), v.marlta);
  if (esValor(antes) && registro.estado !== 'aplicado') {
    // El cambio nunca llegó a aplicarse (o ya está como antes): no hay nada que escribir.
    await historial.marcarDeshecho(id);
    return { codart, tarifa, restaurado: antes };
  }
  if (!esValor(despues)) {
    throw new ErrorDeValidacion(`${codart} ya no está como lo dejó ese cambio (alguien lo ha modificado después). No se deshace.`);
  }
  await delsol.actualizarLineaTarifa(codart, tarifa, antes.marlta, antes.prelta);
  let ok = false;
  for (let i = 0; i < 5 && !ok; i++) {
    if (i > 0) await dormir(esperaMs * 2 ** (i - 1));
    const leida = (await delsol.cargaTabla('F_LTA', filtro))[0];
    ok = !!leida && cerca(Number(leida.PRELTA), antes.prelta) && cerca(Number(leida.MARLTA), antes.marlta);
  }
  if (!ok) throw new ErrorDeVerificacion(`Se intentó deshacer ${codart} pero la relectura no coincide. Revísalo en FactuSOL.`);
  await historial.marcarDeshecho(id);
  return { codart, tarifa, restaurado: antes };
}
