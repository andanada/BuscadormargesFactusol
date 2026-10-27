// Copia de seguridad de TODAS las líneas de tarifa (F_LTA) cada vez que se leen de FactuSOL.
// Es una red de seguridad independiente del historial: si algo se escribe mal, aquí está cómo
// estaba cada precio antes. Se conservan las últimas `maximo` copias.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function guardarCopia(carpeta, datos, ejercicio, maximo = 30) {
  await mkdir(carpeta, { recursive: true });
  const sello = datos.cargadoEn.replace(/[:.]/g, '-');
  const archivo = join(carpeta, `lineas-tarifa-${ejercicio}-${sello}.json`);
  const contenido = { ejercicio, cargadoEn: datos.cargadoEn, lineas: datos.lineas.map((l) => ({ ARTLTA: l.ARTLTA, TARLTA: l.TARLTA, MARLTA: l.MARLTA, PRELTA: l.PRELTA })) };
  await writeFile(archivo, JSON.stringify(contenido), 'utf8');
  const copias = (await readdir(carpeta)).filter((f) => f.startsWith('lineas-tarifa-')).sort();
  for (const vieja of copias.slice(0, Math.max(0, copias.length - maximo))) await rm(join(carpeta, vieja));
  return archivo;
}
