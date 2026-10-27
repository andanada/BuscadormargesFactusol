// Credenciales de FactuSOL. Se leen de un .env (nunca se copian ni se guardan en el repo):
// primero el propio .env del proyecto y, si no existe, el del matcher de Hortitec.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
function requerida(vars, nombre, ruta) {
  const valor = vars[nombre];
  if (!valor) throw new Error(`Falta ${nombre} en ${ruta}`);
  return valor;
}

export function cargarConfig() {
  // Sin fallback silencioso a las credenciales de otro proyecto: o hay un .env propio, o se indica
  // explícitamente FACTUSOL_ENV_FILE (iniciar.bat lo hace con el del matcher).
  const ruta = [process.env.FACTUSOL_ENV_FILE, join(RAIZ, '.env')].find((r) => r && existsSync(r));
  if (!ruta) throw new Error('No encuentro credenciales DELSOL_*: crea un .env en la carpeta del programa o define FACTUSOL_ENV_FILE.');
  const vars = dotenv.parse(readFileSync(ruta));
  return {
    rutaEnv: ruta,
    creds: {
      codigoFabricante: Number(requerida(vars, 'DELSOL_CODIGO_FABRICANTE', ruta)),
      codigoCliente: Number(requerida(vars, 'DELSOL_CODIGO_CLIENTE', ruta)),
      baseDatosCliente: requerida(vars, 'DELSOL_BASE_DATOS_CLIENTE', ruta),
      password: requerida(vars, 'DELSOL_PASSWORD', ruta),
    },
    // Por defecto el año en curso; se muestra siempre en la cabecera del panel para no escribir
    // en un ejercicio equivocado sin darse cuenta.
    ejercicio: vars.DELSOL_EJERCICIO ?? String(new Date().getFullYear()),
    puerto: Number(process.env.PORT ?? 4100),
    // Tarifas en las que se permite ESCRIBIR (por defecto la 1 y la 2). La Tarifa 1 guarda el PVP
    // con IVA y casi todos sus precios están puestos a mano (MARLTA = 0): al escribir un margen
    // se calcula el PVP con IVA desde el coste neto, igual que hace el matcher de Hortitec.
    tarifasEscribibles: new Set((process.env.TARIFAS_ESCRIBIBLES ?? '1,2').split(',').map(Number).filter(Number.isInteger)),
    rutaCopias: join(RAIZ, 'data', 'copias'),
    rutaHistorial: join(RAIZ, 'data', 'historial.jsonl'),
    raiz: RAIZ,
  };
}
