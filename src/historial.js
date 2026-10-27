// Historial de cambios en un fichero JSONL (solo se añade, nunca se reescribe). Cada línea es un
// evento: un cambio aplicado o la marca de que se deshizo. Sirve de auditoría y de snapshot.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Historial {
  #cambios = new Map();

  constructor(ruta) {
    this.ruta = ruta;
  }

  async cargar() {
    await mkdir(dirname(this.ruta), { recursive: true });
    let texto = '';
    try {
      texto = await readFile(this.ruta, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    for (const linea of texto.split('\n').filter(Boolean)) {
      let evento;
      try {
        evento = JSON.parse(linea);
      } catch {
        // Una línea cortada (el proceso murió a mitad de escribir) no debe impedir arrancar:
        // el resto del historial es justo lo que hace falta para deshacer.
        console.warn(`Historial: línea ilegible ignorada (${linea.slice(0, 60)}…)`);
        continue;
      }
      const previo = this.#cambios.get(evento.id);
      if (evento.evento === 'deshecho' && previo) {
        this.#cambios.set(evento.id, { ...previo, estado: 'deshecho', deshechoEn: evento.fecha });
      } else if (evento.evento === 'estado' && previo) {
        this.#cambios.set(evento.id, { ...previo, estado: evento.estado });
      } else if (evento.evento === 'cambio') {
        this.#cambios.set(evento.id, evento);
      }
    }
  }

  async actualizarEstado(id, estado) {
    await appendFile(this.ruta, `${JSON.stringify({ evento: 'estado', id, estado, fecha: new Date().toISOString() })}\n`, 'utf8');
    this.#cambios.set(id, { ...this.#cambios.get(id), estado });
  }

  async registrar(datos) {
    const registro = { evento: 'cambio', id: randomUUID(), fecha: new Date().toISOString(), ...datos };
    await appendFile(this.ruta, `${JSON.stringify(registro)}\n`, 'utf8');
    this.#cambios.set(registro.id, registro);
    return registro;
  }

  async marcarDeshecho(id) {
    const fecha = new Date().toISOString();
    await appendFile(this.ruta, `${JSON.stringify({ evento: 'deshecho', id, fecha })}\n`, 'utf8');
    this.#cambios.set(id, { ...this.#cambios.get(id), estado: 'deshecho', deshechoEn: fecha });
  }

  obtener(id) {
    return this.#cambios.get(id);
  }

  lista(limite = 200) {
    return [...this.#cambios.values()].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, limite);
  }
}
