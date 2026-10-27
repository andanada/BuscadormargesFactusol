// Cálculos puros de coste, PVP y margen. Sin red ni disco: es lo que cubren los tests.
//
// Reglas confirmadas contra datos reales de La Grow:
// - PCOART es el coste BRUTO. El coste real es el neto, tras los descuentos de compra del
//   artículo (DT0ART..DT2ART). El PVP de las tarifas se fijó sobre el coste neto.
// - El margen real se mide siempre sobre el PVP SIN IVA: (pvpSinIva - neto) / neto.
// - Si la tarifa guarda el PVP con IVA (F_TAR.IVATAR = 1), el IVA depende del artículo (TIVART).

export const IVA_TIPOS = { 0: 21, 1: 10, 2: 4, 3: 0 };

export const TRAMOS = [
  { id: 'negativo', etiqueta: 'Negatius', min: -Infinity, max: 0 },
  { id: '0-10', etiqueta: '0 – 10 %', min: 0, max: 10 },
  { id: '10-15', etiqueta: '10 – 15 %', min: 10, max: 15 },
  { id: '15-20', etiqueta: '15 – 20 %', min: 15, max: 20 },
];

const redondea2 = (n) => Math.round(n * 100) / 100;

export function pctIva(tivart) {
  return Object.hasOwn(IVA_TIPOS, tivart) ? IVA_TIPOS[tivart] : null;
}

/** Coste neto: aplica en cadena los descuentos de compra (porcentajes 0-100). */
export function costeNeto(pcoart, descuentos = []) {
  return descuentos.reduce((coste, dto) => coste * (1 - (Number(dto) || 0) / 100), Number(pcoart));
}

/** PVP sin IVA a partir de lo que guarda la tarifa en PRELTA. */
export function pvpSinIva(precioAlmacenado, incluyeIva, ivaPct) {
  return incluyeIva ? redondea2(precioAlmacenado / (1 + ivaPct / 100)) : precioAlmacenado;
}

/** PVP sin IVA para un margen mínimo dado: se redondea hacia ARRIBA al céntimo para que el
 * margen resultante nunca quede por debajo del pedido (con costes bajos, 0,144 -> 0,14 daría un 16,7 %). */
export function pvpSinIvaParaMargen(neto, margenPct) {
  return Math.ceil(neto * (1 + margenPct / 100) * 100 - 1e-9) / 100;
}

/** Valor a escribir en PRELTA para un margen dado sobre el coste neto. */
export function pvpAlmacenadoParaMargen(neto, margenPct, incluyeIva, ivaPct) {
  const sinIva = pvpSinIvaParaMargen(neto, margenPct);
  return incluyeIva ? redondea2(sinIva * (1 + ivaPct / 100)) : sinIva;
}

export function margenReal(neto, precioAlmacenado, incluyeIva, ivaPct) {
  return ((pvpSinIva(precioAlmacenado, incluyeIva, ivaPct) - neto) / neto) * 100;
}

/**
 * Tramo de un margen. Se redondea a 2 decimales antes de clasificar: un PVP guardado con
 * 4 decimales da 9,9999 % para un margen objetivo del 10 %, y eso no es "menos del 10 %".
 * Devuelve null si el margen (redondeado) es >= 20 %.
 */
export function tramoDe(margenPct) {
  const m = redondea2(margenPct);
  return TRAMOS.find((t) => m >= t.min && m < t.max)?.id ?? null;
}
