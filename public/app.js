// Interfície del panell de marges. Tot el text de dades (noms d'article, etc.) es posa amb
// textContent: mai innerHTML amb dades de Factusol.
const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });
const rodona2 = (n) => Math.round(n * 100) / 100;

const estat = {
  llista: null,
  tarifa: 2,
  tram: '0-10',
  cerca: '',
  edicions: new Map(), // codart -> text del nou marge
  marcats: new Set(),
  historial: [],
  ocupat: false,
  aturar: false,
};

const MAX_TANDA = 100; // màxim de canvis per tanda: un error de marge no es pot estendre a tot el catàleg
const REVISIO_A_PARTIR_DE = 10; // a partir d'aquí cal marcar "he revisat la llista" per poder escriure

async function api(ruta, cos) {
  const opcions = cos === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Margenes': '1' }, body: JSON.stringify(cos) };
  const res = await fetch(ruta, opcions);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `Error ${res.status}`), { estat: res.status });
  return json;
}

function toast(text, error = false) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.remove(), error ? 9000 : 4500);
}

function el(etiqueta, props = {}, ...fills) {
  const e = document.createElement(etiqueta);
  const { class: classe, text, ...resta } = props;
  if (classe) e.className = classe;
  if (text !== undefined) e.textContent = text;
  Object.assign(e, resta);
  e.append(...fills);
  return e;
}

const parseMarge = (text) => {
  const t = String(text ?? '').trim().replace(',', '.');
  if (t === '' || !/^\d+(\.\d{1,2})?$/.test(t)) return null; // Factusol guarda el marge amb 2 decimals
  const n = Number(t);
  return n <= 500 ? n : null;
};

// Mateix càlcul que el servidor (calc.js): el PVP s'arrodoneix cap AMUNT al cèntim perquè el marge no quedi per sota.
function pvpNou(item, marge) {
  const sense = Math.ceil(item.costeNeto * (1 + marge / 100) * 100 - 1e-9) / 100;
  return item.incluyeIva ? rodona2(sense * (1 + item.ivaPct / 100)) : sense;
}

const itemsVisibles = () => {
  const q = estat.cerca.trim().toLowerCase();
  return estat.llista.items.filter((i) => i.tramo === estat.tram && (!q || i.codart.toLowerCase().includes(q) || i.desart.toLowerCase().includes(q)));
};

// ---------- Càrrega ----------
let peticioCarrega = 0;
async function carregar() {
  const meva = ++peticioCarrega;
  try {
    const llista = await api(`/api/lista?tarifa=${estat.tarifa}`);
    if (meva !== peticioCarrega) return; // una càrrega més nova ha agafat el relleu
    estat.llista = llista;
    const bad = estat.llista.descartados;
    const descartats = bad.sin_coste + bad.sin_articulo + bad.iva_desconocido;
    $('sub').textContent = `Exercici ${estat.llista.ejercicio} · ${estat.llista.tarifa.nombre}${estat.llista.tarifa.incluyeIva ? ' (PVP amb IVA)' : ' (PVP sense IVA)'} · ${estat.llista.evaluados} articles avaluats` +
      `${descartats ? ` · ${descartats} sense cost o IVA` : ''} · dades de ${fmtData.format(new Date(estat.llista.cargadoEn))}`;
    const sel = $('tarifa');
    sel.replaceChildren(...estat.llista.tarifas.map((t) => el('option', { value: t.codigo, text: t.nombre, selected: t.codigo === estat.tarifa })));
    pintarPestanyes();
    pintarLlista();
    avis(estat.llista.escribible ? null : `${estat.llista.tarifa.nombre} és només de lectura en aquest programa: pots consultar-la però no canviar-la.`);
  } catch (err) {
    avis(`No s'han pogut carregar les dades de Factusol: ${err.message}`, true);
  }
}

function avis(text, error = false) {
  const a = $('avis');
  a.hidden = !text;
  a.className = `avis${error ? ' error' : ''}`;
  a.textContent = text ?? '';
}

function pintarPestanyes() {
  const nav = $('pestanyes');
  const tabs = estat.llista.tramos.map((t) =>
    pestanya(t.id, t.etiqueta, estat.llista.conteo[t.id] ?? 0, t.id === 'negativo' ? 't-negatiu' : ''),
  );
  tabs.push(pestanya('historial', 'Historial', null, ''));
  nav.replaceChildren(...tabs);
}

function pestanya(id, text, num, extra) {
  const b = el('button', { class: `pestanya ${extra}`, type: 'button', role: 'tab' }, text);
  if (num !== null) b.append(el('span', { class: 'num', text: String(num) }));
  b.setAttribute('aria-selected', String(estat.tram === id));
  b.addEventListener('click', () => {
    estat.tram = id;
    estat.marcats.clear();
    pintarPestanyes();
    id === 'historial' ? mostrarHistorial() : mostrarLlista();
  });
  return b;
}

function mostrarLlista() {
  $('vistaLlista').hidden = false;
  $('vistaHistorial').hidden = true;
  pintarLlista();
}

// ---------- Llista ----------
function pintarLlista() {
  const items = itemsVisibles();
  const cos = $('cos');
  cos.replaceChildren(...items.map(fila));
  $('buit').hidden = items.length > 0;
  $('resum').textContent = `${items.length} articles en aquest tram${estat.cerca ? ' (filtrats)' : ''} · ordenats del pitjor al millor marge`;
  $('totes').checked = false;
  actualitzarMarcats();
}

function fila(item) {
  const marge = parseMarge(estat.edicions.get(item.codart));
  const desfasat = Math.abs(item.margenConfigurado - item.margenReal) > 1;

  const nom = el('td', { class: 'nom' }, item.desart);
  if (item.descatalogado) nom.append(el('span', { class: 'etiqueta av', text: 'Descatalogat' }));
  const dtos = item.descuentos.filter((d) => d > 0);
  const celaDte = el('td', { class: `n ${dtos.length ? 'amb-dte' : 'sense-dte'}`, text: dtos.length ? dtos.map((d) => `${fmt.format(d)} %`).join(' + ') : '—' });
  if (dtos.length) celaDte.title = `Cost net = ${fmt.format(item.costeBruto)} € menys el descompte de la fitxa`;
  if (item.multiDescuento) nom.append(el('span', { class: 'etiqueta av', text: 'revisa dtes.', title: 'Té més d\'un descompte de compra; es compten encadenats.' }));

  const nomesLectura = !estat.llista.escribible;
  const check = el('input', { type: 'checkbox', checked: estat.marcats.has(item.codart), disabled: nomesLectura, ariaLabel: `Marca ${item.codart}` });
  check.addEventListener('change', () => {
    check.checked ? estat.marcats.add(item.codart) : estat.marcats.delete(item.codart);
    actualitzarMarcats();
  });

  const entrada = el('input', { class: 'nou', type: 'text', inputMode: 'decimal', placeholder: '%', value: estat.edicions.get(item.codart) ?? '', disabled: nomesLectura, ariaLabel: `Nou marge de ${item.codart}` });
  const pvp = el('td', { class: 'n', text: marge === null ? '—' : fmt.format(pvpNou(item, marge)) });
  const boto = el('button', { class: 'petit secundari', type: 'button', text: 'Aplica', disabled: nomesLectura || marge === null });
  entrada.addEventListener('input', () => {
    estat.edicions.set(item.codart, entrada.value);
    const m = parseMarge(entrada.value);
    entrada.classList.toggle('invalid', entrada.value.trim() !== '' && m === null);
    pvp.textContent = m === null ? '—' : fmt.format(pvpNou(item, m));
    boto.disabled = nomesLectura || m === null;
    actualitzarMarcats();
  });
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && parseMarge(entrada.value) !== null) boto.click();
  });
  boto.addEventListener('click', () => confirmar([item.codart]));

  const classeMarge = item.margenReal < 0 ? 'neg' : item.margenReal < 10 ? 'baix' : '';
  const config = el('td', { class: `n ${desfasat ? 'desfasat' : ''}` }, `${fmt.format(item.margenConfigurado)} %`);
  if (desfasat) {
    const usar = el('button', { class: 'secundari', type: 'button', text: '←', title: `Posa el marge configurat (${item.margenConfigurado} %)` });
    usar.addEventListener('click', () => {
      estat.edicions.set(item.codart, String(item.margenConfigurado));
      pintarLlista();
    });
    config.append(usar);
  }

  return el(
    'tr',
    {},
    el('td', { class: 'c' }, check),
    el('td', { class: 'codi', text: item.codart }),
    nom,
    celaEstoc(item.stock),
    el('td', { class: 'n', text: fmt.format(item.costeBruto) }),
    celaDte,
    el('td', { class: 'n', text: fmt.format(item.costeNeto) }),
    el('td', { class: 'n', text: fmt.format(item.pvpAlmacenado) }),
    el('td', { class: `n marge ${classeMarge}`, text: `${fmt.format(item.margenReal)} %` }),
    config,
    el('td', { class: 'n' }, entrada),
    pvp,
    el('td', {}, boto),
  );
}

const fmtEstoc = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 });

function celaEstoc(stock) {
  if (!stock) return el('td', { class: 'n sense-dte', text: '—', title: 'Sense registre d\'estoc a Factusol' });
  const classe = stock.disponible < 0 ? 'estoc-neg' : stock.disponible === 0 ? 'sense-dte' : 'estoc-ok';
  const cela = el('td', { class: `n ${classe}`, text: fmtEstoc.format(stock.disponible) });
  cela.title = `Disponible ${fmtEstoc.format(stock.disponible)} · actual ${fmtEstoc.format(stock.actual)} · ${stock.almacenes} ${stock.almacenes === 1 ? 'magatzem' : 'magatzems'}`;
  return cela;
}

function actualitzarMarcats() {
  const aplicables = [...estat.marcats].filter((c) => parseMarge(estat.edicions.get(c)) !== null);
  const b = $('aplicarMarcats');
  b.disabled = estat.ocupat || !estat.llista.escribible || aplicables.length === 0;
  b.textContent = aplicables.length ? `Aplica els marcats (${aplicables.length})` : 'Aplica els marcats';
}

// ---------- Confirmació i escriptura ----------
function confirmar(codarts) {
  if (estat.ocupat || !estat.llista.escribible) return;
  const items = codarts.map((c) => estat.llista.items.find((i) => i.codart === c)).filter(Boolean);
  const canvis = items.map((item) => ({ item, marge: parseMarge(estat.edicions.get(item.codart)) })).filter((c) => c.marge !== null);
  if (!canvis.length) return;
  if (canvis.length > MAX_TANDA) {
    return toast(`Màxim ${MAX_TANDA} canvis per tanda (n'has marcat ${canvis.length}). Fes-ho en diverses tandes.`, true);
  }
  const cal = canvis.length > REVISIO_A_PARTIR_DE;
  $('confRevisat').hidden = !cal;
  $('confCheck').checked = false;
  $('confOk').disabled = cal;
  $('confCheck').onchange = (e) => {
    $('confOk').disabled = !e.target.checked;
  };

  $('confTitol').textContent = canvis.length === 1 ? 'Confirma el canvi' : `Confirma ${canvis.length} canvis`;
  $('confCos').replaceChildren(
    ...canvis.map(({ item, marge }) =>
      el(
        'tr',
        {},
        el('td', { text: `${item.codart} · ${item.desart}` }),
        el('td', { class: 'n', text: `${fmt.format(item.pvpAlmacenado)} → ${fmt.format(pvpNou(item, marge))}` }),
        el('td', { class: 'n', text: `${fmt.format(item.margenReal)} % → ${fmt.format(marge)} %` }),
      ),
    ),
  );
  const dialeg = $('confirmacio');
  dialeg.returnValue = '';
  dialeg.onclose = () => {
    if (dialeg.returnValue === 'ok') escriure(canvis);
  };
  dialeg.showModal();
}

async function escriure(canvis) {
  estat.ocupat = true;
  estat.aturar = false;
  actualitzarMarcats();
  let fets = 0;
  let aturat = false;
  const errors = [];
  const progres = $('progres');
  progres.hidden = false;
  $('atura').disabled = false;
  for (const [i, { item, marge }] of canvis.entries()) {
    if (estat.aturar) {
      aturat = true;
      break;
    }
    $('progresText').textContent = `Escrivint a Factusol… ${i + 1} de ${canvis.length} (${item.codart})`;
    try {
      await api('/api/aplicar', {
        codart: item.codart,
        tarifa: item.tarifa,
        pvpAntesEsperado: item.pvpAlmacenado,
        pvpNuevoEsperado: pvpNou(item, marge),
        nuevoMargen: marge,
      });
      estat.edicions.delete(item.codart);
      estat.marcats.delete(item.codart);
      fets++;
    } catch (err) {
      errors.push(`${item.codart}: ${err.message}`);
      // Només un rebuig de validació (400) deixa continuar la tanda. Qualsevol altre error
      // (verificació, timeout, xarxa) l'atura: cal mirar l'estat real a mà abans de seguir.
      if (err.estat !== 400) {
        errors.push('La tanda s\'ha aturat. Revisa l\'Historial abans de continuar.');
        break;
      }
    }
  }
  estat.ocupat = false;
  progres.hidden = true;
  if (aturat) toast(`Tanda aturada: ${fets} de ${canvis.length} aplicats. La resta no s'ha tocat.`);
  if (fets) toast(`${fets} ${fets === 1 ? 'canvi aplicat' : 'canvis aplicats'} a Factusol i verificats.`);
  errors.forEach((e) => toast(e, true));
  if (errors.length) await api('/api/recargar', {}).catch(() => {}); // evita mostrar dades velles després d'un error
  await carregar();
}

// ---------- Historial ----------
async function mostrarHistorial() {
  $('vistaLlista').hidden = true;
  $('vistaHistorial').hidden = false;
  try {
    estat.historial = (await api('/api/historial')).cambios;
  } catch (err) {
    return toast(err.message, true);
  }
  $('buitHistorial').hidden = estat.historial.length > 0;
  $('cosHistorial').replaceChildren(
    ...estat.historial.map((c) => {
      const desfer = el('button', { class: 'petit secundari', type: 'button', text: 'Desfés' });
      desfer.addEventListener('click', async () => {
        desfer.disabled = true;
        try {
          await api('/api/deshacer', { id: c.id });
          toast(`${c.codart} restaurat.`);
          await carregar();
          await mostrarHistorial();
        } catch (err) {
          toast(err.message, true);
          desfer.disabled = false;
        }
      });
      const text =
        { aplicado: 'Aplicat', deshecho: 'Desfet', verificacion_fallida: 'Estat incert: revisa', pendiente: 'Pendent: revisa', no_aplicado: 'No aplicat' }[c.estado] ?? c.estado;
      const desfeable = ['aplicado', 'verificacion_fallida', 'pendiente'].includes(c.estado);
      return el(
        'tr',
        {},
        el('td', { text: fmtData.format(new Date(c.fecha)) }),
        el('td', { class: 'codi', text: c.codart }),
        el('td', { text: c.desart }),
        el('td', { text: String(c.tarifa) }),
        el('td', { class: 'n', text: `${fmt.format(c.antes.marlta)} → ${fmt.format(c.despues.marlta)} %` }),
        el('td', { class: 'n', text: `${fmt.format(c.antes.prelta)} → ${fmt.format(c.despues.prelta)}` }),
        el('td', { class: c.estado === 'aplicado' ? 'estat-aplicat' : ['verificacion_fallida', 'pendiente'].includes(c.estado) ? 'estat-fallit' : '', text }),
        el('td', {}, desfeable ? desfer : ''),
      );
    }),
  );
}

// ---------- Esdeveniments ----------
$('tarifa').addEventListener('change', (e) => {
  estat.tarifa = Number(e.target.value);
  estat.edicions.clear();
  estat.marcats.clear();
  carregar();
});
$('cerca').addEventListener('input', (e) => {
  estat.cerca = e.target.value;
  if (estat.llista && estat.tram !== 'historial') pintarLlista();
});
$('totes').addEventListener('change', (e) => {
  for (const i of itemsVisibles()) e.target.checked ? estat.marcats.add(i.codart) : estat.marcats.delete(i.codart);
  pintarLlista();
  $('totes').checked = e.target.checked;
});
$('massiuAplicar').addEventListener('click', () => {
  const m = parseMarge($('massiuValor').value);
  if (m === null) return toast('Escriu un marge entre 0 i 500.', true);
  const marcats = [...estat.marcats];
  if (!marcats.length) return toast('Marca primer algun article.', true);
  marcats.forEach((c) => estat.edicions.set(c, String(m)));
  pintarLlista();
});
$('aplicarMarcats').addEventListener('click', () => confirmar([...estat.marcats]));
$('atura').addEventListener('click', () => {
  estat.aturar = true;
  $('atura').disabled = true;
  $('progresText').textContent = 'Aturant: s\'acaba el canvi en curs i es para…';
});
$('recarregar').addEventListener('click', async () => {
  $('recarregar').disabled = true;
  try {
    await api('/api/recargar', {});
    await carregar();
    toast('Dades rellegides de Factusol.');
  } catch (err) {
    toast(err.message, true);
  }
  $('recarregar').disabled = false;
});

carregar();
