# PokeVault

Catálogo y precios de Pokémon TCG para el mercado europeo. Cartas y producto
sellado, separados por set, en euros.

```bash
npm install
npm run ingest              # catálogo + precios de Cardmarket (~5 s)
npm run map-sets            # nombre de las expansiones (la primera vez, unos minutos)
npm run names-en            # nombre oficial en inglés de los sets japoneses
npm run classify            # separa sets de verdad de agrupaciones
npm run backfill-images -- all   # imágenes de las cartas (lento, resumible)
npm run dev                 # http://localhost:3000
```

`ingest` es lo único que hay que ejecutar a diario. Los otros cuatro solo
cuando salen sets nuevos.

---

## De dónde salen los datos

| Fuente | Qué aporta | Coste |
|---|---|---|
| **Cardmarket** (ficheros públicos) | Catálogo completo y precios en EUR, cartas y sellado | Gratis, sin API key |
| **TCGdex** | Nombres de set y series en castellano, imágenes de carta | Gratis, sin API key |
| **TCGCSV** | Nombre oficial en inglés de los sets japoneses | Gratis, pide User-Agent propio |

Cardmarket retiró estos datos de su API —que está cerrada a nuevas
solicitudes— y los publica como ficheros sueltos en un bucket S3:

```
https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json
https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json
https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json
```

El `6` es el ID de Pokémon. Son ~28 MB en total, se bajan en un par de
segundos y **no pasan por el Cloudflare** que protege `www.cardmarket.com`, así
que funcionan igual desde Railway que desde tu portátil.

---

## Cómo funciona la actualización diaria

Cardmarket regenera el price guide **una vez al día, de madrugada** (sobre las
02:45 CET). Cada fichero lleva dentro un campo `createdAt` con la marca exacta
de cuándo se generó. Eso es lo que gobierna todo el proceso:

```
npm run ingest
  │
  ├─ 1. Baja el price guide y lee su createdAt
  │      ¿coincide con el de la última ejecución correcta?
  │         → sí: no hace nada y se sale
  │         → no: sigue
  │
  ├─ 2. Baja el catálogo (cartas + sellados) y actualiza `products`
  │
  ├─ 3. Compara los precios nuevos con los que ya había guardados
  │      y escribe en `price_history` SOLO los que han cambiado
  │
  └─ 4. Sobrescribe `prices` con la foto de hoy
```

**El paso 1 es lo que lo hace seguro.** Puedes lanzarlo cada hora si quieres: si
no hay volcado nuevo, sale en menos de un segundo sin tocar nada. Eso también
significa que si un día Railway falla o tú estabas de vacaciones, la siguiente
ejecución recupera sola.

**El paso 3 es lo que hace que el proyecto valga algo.** Cardmarket te da la
foto de hoy y nada más: no publica el pasado. El histórico solo existe si lo
guardas tú, y cada día que no lo guardas es un día que ya no se recupera.
Guardar solo los cambios en vez de las 77.263 filas enteras es la diferencia
entre ~28 millones de filas al año y unos pocos millones.

> Un hueco en `price_history` significa "ese día no cambió". Al leer la serie
> hay que arrastrar el último valor conocido, no interpretarlo como un cero.

### Ponerlo en automático en Railway

Un servicio de tipo *cron* con el comando `npm run ingest` y esta expresión:

```
0 5 * * *
```

Las 05:00 UTC dan margen de sobra sobre el volcado de las ~02:45 CET. Si algún
día Cardmarket se retrasa, el `createdAt` viejo hace que no se procese nada y
la ejecución del día siguiente lo arregla.

La tabla `ingest_runs` guarda cada ejecución con su estado (`ok`, `skipped`,
`error`), así que se puede comprobar que el cron va bien sin entrar a mirar.

---

## Estructura

```
src/
  lib/cardmarket.ts          descarga de los ficheros de Cardmarket
  lib/tcgdex.ts              catálogo de sets + puente de IDs
  lib/tcgcsv.ts              espejo de TCGplayer (nombres japoneses en inglés)
  lib/admin.ts               autenticación del panel
  db/index.ts                conexión y esquema
  db/queries.ts              consultas de lectura para la web
  scripts/ingest.ts          la actualización diaria
  scripts/map-sets.ts        nombres de expansión
  scripts/names-en.ts        nombre oficial inglés de los sets japoneses
  scripts/classify.ts        distingue sets reales de agrupaciones
  scripts/backfill-images.ts imágenes de carta (resumible)
  app/                       Next.js (App Router)
  app/admin/                 panel privado
```

---

## Sistema visual

Gris oscuro neutro, densidad alta, y **color solo donde significa algo**: verde
y rojo para movimiento de precio, ámbar para avisos, y nada más. El resto es
escala de grises. La herramienta debe desaparecer detrás del dato.

Reglas que sostienen el conjunto, todas en `src/app/globals.css`:

- **Elevación por borde, nunca por sombra.** Una sombra bajo un borde de 1px se
  nota el doble en gris oscuro.
- **Escala de tipo fija en rem**, razón ~1.2, una sola familia. Nada de tamaños
  fluidos: esto se mira a DPI constante, no es una landing.
- **Cifras siempre tabulares** (`font-variant-numeric: tabular-nums`), para que
  las columnas de precio se puedan comparar de un vistazo.
- **El índice es una lista densa, no un mosaico de tarjetas.** Con 196 sets, lo
  que se necesita es escanear y comparar, no pasear.
- Las tablas anchas hacen scroll dentro de su propio panel; la página nunca.

Contraste verificado sobre el resultado renderizado: todo el texto pasa 4.5:1.

---

## Panel privado

En `/admin`, protegido por token. Muestra la cobertura del catálogo, el estado
de las últimas ingestas, qué sets están pendientes de imágenes y —lo más
útil— **qué expansiones quedan por identificar**, ordenadas por volumen.

Se activa poniendo `ADMIN_TOKEN` en `.env.local`:

```
ADMIN_TOKEN=algo-largo-y-aleatorio
```

**Sin esa variable el panel no existe** (devuelve 404): falla cerrado. El token
se compara en tiempo constante y se guarda en una cookie `httpOnly`. No hay
enlace al panel desde ninguna parte de la web pública.

Es autenticación de una sola persona, deliberadamente simple. Si algún día
entra alguien más al proyecto, esto hay que cambiarlo por usuarios de verdad.

### El puente de IDs

Los ficheros de Cardmarket traen `idExpansion` pero **no el nombre del set**.
TCGdex sí tiene nombres, y además expone en cada carta su
`pricing.cardmarket.idProduct`. Con eso:

```
set de TCGdex → una carta suya → idProduct → products.id_expansion
```

y queda identificada la expansión entera, sellados incluidos. `map-sets` solo
procesa lo que aún no está mapeado, así que después de la primera vez tarda
segundos. Hay que lanzarlo cuando sale un set nuevo.

---

## Alcance: occidente y Japón

Cardmarket vende más mundos de los que este catálogo cubre. La web pública
muestra **solo los sets identificados contra TCGdex**, que por construcción son
occidentales o japoneses.

- **Corea no necesita nada.** Los sets coreanos son los mismos que los
  japoneses y en Cardmarket comparten producto: `ko/SV4M` y `ja/SV4M` devuelven
  el mismo `idProduct`. El idioma es un atributo del anuncio, no un set aparte.
- **China queda fuera por imposibilidad, no por decisión.** TCGdex no enlaza
  las cartas chinas con Cardmarket, así que no hay puente. Sus expansiones
  quedan sin identificar y no aparecen en la web.

### Las 776 "expansiones" no son 776 sets

Cardmarket no distingue un set de una agrupación cualquiera. `npm run classify`
lo deduce del catálogo con una regla comprobable —**una expansión de verdad se
vende en sobres**— y deja el reparto en el panel:

| Clase | Qué es | Cuántas |
|---|---|---|
| `main` | Expansiones de verdad, con sobre o display propio | 408 |
| `promo` | Promos, mazos y colecciones | 214 |
| `minor` | Menos de 20 cartas | 143 |
| `sealed-only` | Monedas, lotes, tins | 6 |
| `energy` | Sets de energías | 5 |

De ellas hay **196 identificadas: 161 occidentales y 35 japonesas**.

> Cuidado con los IDs de set: **colisionan entre catálogos**. `SV10` es
> *Destined Rivals* en inglés y *The Glory of Team Rocket* en japonés, y son
> sets distintos. La clave siempre es el par (idioma, id).

---

## Limitaciones conocidas

- **De las 408 expansiones reales, 243 siguen sin identificar.** Parte son
  chinas (sin puente posible) y el resto japonesas que TCGdex no enlaza. El
  panel las lista ordenadas por volumen.
- **El producto sellado no tiene medias de venta.** Cardmarket solo publica
  `avg1/avg7/avg30` para cartas; para sellado da `trend`, `avg` y `low`. La
  evolución de sellado hay que construirla con el histórico propio.
- **Las cartas japonesas no tienen imagen.** TCGdex las cataloga y les da
  precio, pero no tiene fotos de ellas. Quedan mapeadas y sin foto.
- **El sellado no tiene imagen.** Ni Cardmarket ni TCGdex las publican.
  TCGplayer sí, pero cruzar sellado EU↔US por nombre da un 24% de acierto y
  con falsos positivos (la ETB de Pokémon Center se confunde con la normal),
  así que no se ha hecho. Hace falta otra idea.
- **El enlace a Cardmarket es una búsqueda, no la ficha directa.** La URL de
  ficha es `/Products/Singles/{Expansion-Slug}/{Producto-Slug}` y no se puede
  construir: el slug lleva el nombre inglés de la expansión, que los ficheros
  públicos no traen, y no existe ninguna ruta por `idProduct`. La búsqueda por
  el nombre exacto del producto —que es literalmente el nombre de Cardmarket—
  cae en la ficha y nunca da 404.
- **SQLite** es para el prototipo. En Railway hace falta un volumen persistente
  (el disco es efímero) o, mejor, pasar a Postgres: el SQL es estándar a
  propósito y está todo en `src/db/`.

---

Proyecto independiente. Sin relación con Nintendo, The Pokémon Company ni
Cardmarket. Los precios son de Cardmarket y el catálogo de cartas de TCGdex.
