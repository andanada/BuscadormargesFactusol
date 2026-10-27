# Buscador de márgenes FactuSOL

Panel web local para **revisar los artículos con margen por debajo del 20 %** en FactuSOL y
**corregirlos escribiendo directamente en FactuSOL** (API Delsol, `api.sdelsol.com`).
Proyecto independiente: no comparte código ni credenciales con el conector PrestaShop ni con el
matcher de Hortitec (solo lee el `.env` del matcher si se le indica, sin copiarlo).

Repo: https://github.com/andanada/BuscadormargesFactusol.git · Estado a 2026-10-27.

## Cómo se usa

```
iniciar.bat                      # arranca y abre http://127.0.0.1:4100/
npm test                         # 26 tests (node:test, sin dependencias de test)
```

Credenciales: variables `DELSOL_CODIGO_FABRICANTE`, `DELSOL_CODIGO_CLIENTE`,
`DELSOL_BASE_DATOS_CLIENTE`, `DELSOL_PASSWORD` (y opcional `DELSOL_EJERCICIO`, por defecto el año
en curso) en un `.env` de esta carpeta, o en el fichero que indique `FACTUSOL_ENV_FILE`
(`iniciar.bat` usa el del matcher si no hay `.env` propio). No hay fallback silencioso.

Variables opcionales: `PORT` (4100), `TARIFAS_ESCRIBIBLES` (por defecto `2`).

## Qué muestra

- Pestañas por tramo de margen real: **Negatius**, **0–10 %**, **10–15 %**, **15–20 %** e **Historial**.
- Selector de tarifa. Por fila: estoc (suma de almacenes, `F_STO.DISSTO`), cost brut (`PCOART`),
  descuento de compra de la ficha (`DT0ART..DT2ART`), cost net, PVP actual, margen real, margen
  configurado (`MARLTA`, con botón ← para copiarlo si está desfasado), nuevo margen, nuevo PVP.
- Etiquetas: *Descatalogat* (`REFART` empieza por "Descatalogado"), *revisa dtes.* (más de un descuento).
- Buscador por código/nombre, marcar varias filas, "Posa el mateix marge als marcats".

## Reglas de negocio aprendidas (verificadas con datos reales, no reinvestigar)

1. `PCOART` es el coste **bruto**. El coste real es el **neto** tras el descuento de compra del
   artículo: `neto = PCOART × (1 − DT0ART/100) × …`. El PVP de las tarifas se fijó sobre el neto.
   Calcular con el bruto daba 53 falsos "negativos" (el 617253 con dto 50 % parecía −32 %).
2. Margen real = `(PVP sin IVA − neto) / neto`. La **Tarifa 2 (Associaciones)** guarda el PVP
   **sin IVA**; la **Tarifa 1** lo guarda **con IVA** (`F_TAR.IVATAR`), IVA por artículo (`TIVART`: 0=21, 1=10, 2=4, 3=0).
3. `MARLTA` (margen guardado) **no es fiable**: en cientos de artículos no coincide con el real.
   La lista se calcula siempre desde los precios, no desde `MARLTA`.
4. El stock real está en `F_STO` (una fila por artículo y almacén); `F_ART.STOART` suele ser 0.
5. El PVP se guarda con 4 decimales, así que un margen objetivo del 10 % se lee como 9,9999 %:
   los tramos se clasifican con el margen **redondeado a 2 decimales** (antes salían 63 artículos
   en "0–10 %" que en realidad estaban al 10 % exacto).
6. Validación de la fórmula contra FactuSOL real (solo lectura): en la Tarifa 2, 4.363 de 4.575
   líneas (95,4 %) dan el PVP exacto (±0,015 €); los 212 restantes son precios movidos a mano.
7. **Tarifa 1**: casi todas sus líneas tienen `MARLTA = 0` (precios puestos a mano, p. ej. 199 €);
   el cálculo por margen ahí **no está validado**, por eso está en solo lectura.

## Seguridad y fiabilidad al escribir

- Escucha solo en `127.0.0.1`; rechaza hosts ajenos (DNS rebinding); los POST exigen cabecera
  `X-Margenes: 1` + `application/json` (bloquea CSRF desde otras webs). Sin `innerHTML` con datos.
- Solo se puede escribir en las tarifas de `TARIFAS_ESCRIBIBLES` (por defecto solo la 2).
- Antes de escribir relee el artículo en fresco y rechaza si el PVP actual **o** el PVP nuevo
  ya no son los que confirmó el usuario (el coste pudo cambiar).
- Límite de ×3 en el cambio de PVP (salvo `forzar`); margen 0–500 %, redondeado a 2 decimales;
  el PVP se redondea hacia **arriba** al céntimo (el margen nunca queda por debajo del pedido).
- Snapshot **antes** de escribir (estado `pendiente` en `data/historial.jsonl`), escritura, relectura
  de verificación con reintentos, y estado final: `aplicado` / `no_aplicado` / `verificacion_fallida`.
  Ante timeout se relee para saber si se aplicó o no. Las escrituras van de una en una.
- **Copia de seguridad** de las 9.000+ líneas de tarifa en `data/copias/` cada vez que se leen
  datos (últimas 30). Sin copia, el servidor se niega a escribir.
- **Historial con "Desfés"**: restaura el valor anterior solo si la línea sigue como la dejó el
  cambio (no pisa cambios de otra persona).
- En la interfaz: máximo 100 cambios por tanda, casilla "he revisat la llista" a partir de 10,
  botón **Atura**, la tanda se detiene ante cualquier error que no sea de validación, recarga de
  datos tras un error.
- Revisado por un agente `code-reviewer` (0 críticos, 2 altos, 3 medios, 5 bajos): todo corregido.

## Estructura

```
src/calc.js        cálculo puro: coste neto, PVP, margen, tramos        (test/calc.test.js)
src/delsol.js      cliente API Delsol (login, CargaTabla, ActualizarRegistro F_LTA)
src/margenes.js    lista por tarifa, aplicarMargen, deshacer, stock      (test/margenes.test.js)
src/historial.js   historial JSONL append-only                           (test/historial.test.js)
src/copias.js      copias de seguridad de F_LTA                          (test/copias.test.js)
src/server.js      servidor http local + defensas
src/config.js      credenciales y opciones
public/            interfaz (index.html, app.js, style.css; textos en catalán)
data/              historial y copias (NO se versiona)
```

## Hecho

- [x] Servidor MCP de solo lectura de Factusol (`C:\Users\andan\mcp-servers\factusol-mcp`, fuera de este repo).
- [x] Análisis de márgenes de la Tarifa Associaciones y descubrimiento del descuento de compra.
- [x] Panel con tramos, edición por fila y por lotes, escritura verificada, historial y deshacer.
- [x] Columnas de cost brut, descuento de ficha y estoc.
- [x] Tests de cálculo, escritura (con FactuSOL simulado), historial y copias.
- [x] Revisión de código y correcciones; validación de la fórmula contra datos reales.
- [x] Primer cambio real (hecho con el flujo del matcher, no con este programa): **3342 Balastro ETI 1000W**,
      Tarifa 2, margen −18 → 20 %, PVP 132,348 → 193,68 (para revertir: margen −18 y PVP 132,348).

## Pendiente

- [ ] **Primera escritura real desde este programa**. Todo está probado con FactuSOL simulado y
      con lecturas reales, pero ninguna escritura real ha salido de aquí todavía. Propuesta: un
      piloto con un solo artículo, comprobado a mano en FactuSOL, y probar también "Desfés".
- [ ] **Corregir el matcher de Hortitec** (`Factu-Hortitec-Matcher`): ignora `DT0ART`; su pestaña
      Márgenes calcula con el coste bruto y propondría duplicar el PVP en los ~331 artículos con
      descuento de compra. No se ha tocado.
- [ ] Decidir y aplicar márgenes a los artículos bajo el 20 % (datos del 2026-10-27, Tarifa 2):
      33 en 0–10 %, 261 en 10–15 %, 1.169 en 15–20 % (la mayoría es el 15 % por defecto de la tarifa).
      Candidatos claros (margen configurado > real): 799031, 781538 y similares; el 911999 ya no sale en la tarifa.
- [ ] Validar el cálculo por margen en la **Tarifa 1** antes de permitir escribir en ella.
- [ ] Revisar el artículo con **más de un descuento** de compra (se combinan en cadena; sin confirmar).
- [ ] 21 artículos sin coste (`PCOART = 0`) y 4 con stock negativo.
- [ ] Filtro "només amb estoc", ordenar por columnas, exportar CSV, valor inmovilizado (stock × coste).
- [ ] Carga de datos al arrancar (hoy es perezosa: la primera petición tarda unos 10 s).
- [ ] Tests de interfaz / extremo a extremo (hoy solo se ha probado a mano en el navegador).
- [ ] Arranque automático con Windows (hoy se lanza con `iniciar.bat`).
