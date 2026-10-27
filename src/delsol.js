// Cliente mínimo de la API de FactuSOL Nube (api.sdelsol.com).
// Lecturas: reintento único ante 401. Escrituras: nunca se reintentan solas.
const BASE_URL = 'https://api.sdelsol.com';
const TIMEOUT_MS = 60_000;

export class DelsolClient {
  #cached = null;
  #login = null;

  constructor({ creds, ejercicio, fetchImpl = fetch }) {
    this.creds = creds;
    this.ejercicio = ejercicio;
    this.fetch = fetchImpl;
  }

  async #token(force = false) {
    const ahora = Math.floor(Date.now() / 1000);
    if (!force && this.#cached && this.#cached.exp - ahora >= 20) return this.#cached.token;
    this.#login ??= this.#autenticar().finally(() => (this.#login = null));
    return this.#login;
  }

  async #autenticar() {
    const { codigoFabricante, codigoCliente, baseDatosCliente, password } = this.creds;
    const res = await this.fetch(`${BASE_URL}/login/Autenticar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigoFabricante, codigoCliente, baseDatosCliente, password: Buffer.from(password).toString('base64') }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json();
    if (json.respuesta !== 'OK' || !json.resultado) throw new Error(`Login en FactuSOL fallido (${json.respuesta ?? res.status}).`);
    let exp = ahora() + 180;
    try {
      exp = JSON.parse(Buffer.from(json.resultado.split('.')[1], 'base64').toString()).exp ?? exp;
    } catch {
      // el token se usa igual; solo se pierde el refresco proactivo
    }
    this.#cached = { token: json.resultado, exp };
    return json.resultado;
  }

  async #post(ruta, cuerpo, { reintentar401 }) {
    for (let intento = 1; ; intento++) {
      const token = await this.#token(intento > 1);
      const res = await this.fetch(`${BASE_URL}${ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const sinAutorizar = res.status === 401;
      const json = sinAutorizar ? { respuesta: 'Unauthorized' } : await res.json();
      if (json.respuesta === 'Unauthorized' && reintentar401 && intento === 1) {
        this.#cached = null;
        continue;
      }
      if (json.respuesta !== 'OK') throw new Error(`FactuSOL respondió error en ${ruta}: ${JSON.stringify(json).slice(0, 300)}`);
      return json.resultado;
    }
  }

  /** Devuelve las filas como objetos planos { COLUMNA: valor }. */
  async cargaTabla(tabla, filtro) {
    const filas = await this.#post('/admin/CargaTabla', { ejercicio: this.ejercicio, tabla, filtro }, { reintentar401: true });
    return filas.map((fila) => Object.fromEntries(fila.map(({ columna, dato }) => [columna, dato])));
  }

  /** Escribe SOLO el PVP (PRELTA) de una línea de tarifa existente, sin tocar su margen (MARLTA). */
  async actualizarPrecioLinea(codart, tarifa, prelta) {
    const registro = [
      { columna: 'ARTLTA', dato: codart },
      { columna: 'TARLTA', dato: tarifa },
      { columna: 'PRELTA', dato: prelta },
    ];
    return this.#post('/admin/ActualizarRegistro', { ejercicio: this.ejercicio, tabla: 'F_LTA', registro }, { reintentar401: false });
  }

  /** Escribe margen y PVP de UNA línea de tarifa existente (F_LTA). */
  async actualizarLineaTarifa(codart, tarifa, marlta, prelta) {
    const registro = [
      { columna: 'ARTLTA', dato: codart },
      { columna: 'TARLTA', dato: tarifa },
      { columna: 'MARLTA', dato: marlta },
      { columna: 'PRELTA', dato: prelta },
    ];
    return this.#post('/admin/ActualizarRegistro', { ejercicio: this.ejercicio, tabla: 'F_LTA', registro }, { reintentar401: false });
  }
}

function ahora() {
  return Math.floor(Date.now() / 1000);
}
