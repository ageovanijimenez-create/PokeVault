import Database from 'better-sqlite3'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * En Railway hay que apuntar esto al volumen (`DB_PATH=/data/pokevault.sqlite`).
 * El disco por defecto es efímero: sin volumen, cada despliegue se lleva por
 * delante el histórico de precios, que es lo único que no se puede reconstruir.
 */
export const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data', 'pokevault.sqlite')

/** Fichero que deja `/api/admin/restore` para que lo recojamos al arrancar. */
export const INCOMING_PATH = `${DB_PATH}.incoming`

/**
 * La conexión se abre PEREZOSAMENTE, en el primer uso real.
 *
 * Abrirla al importar el módulo tumbaba el build: `next build` lanza nueve
 * procesos en paralelo para recolectar la configuración de las rutas, los
 * nueve importaban este fichero, y los nueve intentaban crear el esquema a la
 * vez sobre el mismo SQLite → "database is locked".
 *
 * Con la apertura diferida, el build solo lee los módulos y no toca el disco:
 * la base no se abre hasta que llega una petición de verdad.
 */
let conexion: Database.Database | null = null

function abrir(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true })

  // Si hay una base subida esperando, se coloca ANTES de abrir nada. Hacer el
  // cambiazo con la conexión abierta corrompe la base. Los `-wal` y `-shm`
  // viejos hay que borrarlos: son de la base anterior y aplicarlos sobre la
  // nueva la destrozan.
  if (existsSync(INCOMING_PATH)) {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${DB_PATH}${suffix}`, { force: true })
    }
    renameSync(INCOMING_PATH, DB_PATH)
    console.log('[db] Base restaurada desde la subida pendiente')
  }

  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  // Si otro proceso está escribiendo, esperar en vez de fallar en el acto.
  db.pragma('busy_timeout = 10000')

  crearEsquema(db)
  return db
}

/**
 * Esquema. SQL estándar a propósito: mover esto a Postgres en Railway es
 * cambiar INTEGER PRIMARY KEY por BIGINT y poco más.
 */
function crearEsquema(db: Database.Database) {
  db.exec(`
CREATE TABLE IF NOT EXISTS expansions (
  id_expansion  INTEGER PRIMARY KEY,   -- id de expansión de Cardmarket
  tcgdex_set_id TEXT,                  -- 'me05', 'sv08'... null si aún no está mapeada
  name          TEXT,
  serie         TEXT,
  release_date  TEXT,
  logo          TEXT,
  symbol        TEXT,
  card_count    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_expansions_tcgdex ON expansions(tcgdex_set_id);

CREATE TABLE IF NOT EXISTS products (
  id_product    INTEGER PRIMARY KEY,   -- id de producto de Cardmarket
  name          TEXT NOT NULL,
  id_category   INTEGER,
  category_name TEXT,
  id_expansion  INTEGER,
  is_sealed     INTEGER NOT NULL DEFAULT 0,
  date_added    TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_expansion ON products(id_expansion);
CREATE INDEX IF NOT EXISTS idx_products_name      ON products(name);

-- Precio actual: una fila por producto, se sobrescribe cada día.
CREATE TABLE IF NOT EXISTS prices (
  id_product INTEGER PRIMARY KEY,
  avg REAL, low REAL, trend REAL,
  avg1 REAL, avg7 REAL, avg30 REAL,
  avg_holo REAL, low_holo REAL, trend_holo REAL,
  avg1_holo REAL, avg7_holo REAL, avg30_holo REAL,
  updated_at TEXT
);

-- Histórico: una fila por producto y día, SOLO cuando el precio cambia.
-- Es lo único que Cardmarket no nos da y que nadie nos puede quitar.
CREATE TABLE IF NOT EXISTS price_history (
  id_product INTEGER NOT NULL,
  day        TEXT    NOT NULL,
  trend REAL, avg REAL, low REAL, avg7 REAL, avg30 REAL,
  PRIMARY KEY (id_product, day)
);

-- Bitácora de ejecuciones, para saber si el cron va bien sin entrar a mirar.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT,
  finished_at       TEXT,
  source_created_at TEXT,
  products_upserted INTEGER,
  prices_upserted   INTEGER,
  history_rows      INTEGER,
  status            TEXT,
  error             TEXT
);

CREATE TABLE IF NOT EXISTS image_backfill (
  tcgdex_set_id TEXT PRIMARY KEY,
  done_at       TEXT,
  matched       INTEGER,
  total         INTEGER
);

-- Sets de TCGdex que se intentaron mapear y no casaron con ninguna expansión
-- de Cardmarket (chinos, promos que TCGdex no enlaza...). Sin esto, cada
-- ejecución automática volvía a sondear ~190 sets fallidos: casi mil
-- peticiones diarias a TCGdex para nada.
CREATE TABLE IF NOT EXISTS set_attempts (
  tcgdex_set_id TEXT NOT NULL,
  lang          TEXT NOT NULL,
  last_try      TEXT,
  tries         INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tcgdex_set_id, lang)
);

-- Tareas de mantenimiento lanzadas desde el panel o encadenadas tras la
-- ingesta. Se guardan aquí para poder seguirlas desde la web.
CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,          -- running | ok | error
  detail      TEXT,                   -- última línea de progreso
  error       TEXT,
  trigger     TEXT                    -- manual | auto
);

-- Cuatro cosas sueltas que no merecen tabla propia. Ahora mismo solo el ETag
-- del último price guide visto, para que el planificador no se baje 15 MB
-- cada vez que arranca el servicio.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`)

  /** Añade una columna solo si aún no existe. Evita tener que borrar la base. */
  const addColumn = (table: string, column: string, type: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    }
  }

  // Idioma de TCGdex del que salió el set ('en' | 'ja'): de ahí vienen sus
  // cartas y sus imágenes, y sirve para saber cuáles son japoneses.
  addColumn('expansions', 'lang', 'TEXT')
  addColumn('expansions', 'name_en', 'TEXT')

  // Qué clase de "expansión" es realmente. Cardmarket mete en el mismo saco los
  // sets de verdad y un montón de agrupaciones que no lo son. Ver `classify.ts`.
  addColumn('expansions', 'kind', 'TEXT')

  // Imagen y carta de TCGdex asociadas al producto de Cardmarket.
  addColumn('products', 'image', 'TEXT')
  addColumn('products', 'tcgdex_card_id', 'TEXT')
}

/**
 * Se usa igual que la conexión de siempre (`db.prepare(...)`), pero por dentro
 * no existe hasta que alguien la toca. El Proxy es lo que permite mantener la
 * apertura diferida sin cambiar las decenas de usos que hay repartidos.
 */
export const db = new Proxy({} as Database.Database, {
  get(_target, prop, receiver) {
    conexion ??= abrir()
    const valor = Reflect.get(conexion, prop, receiver)
    return typeof valor === 'function' ? valor.bind(conexion) : valor
  },
})

export const getMeta = (key: string): string | null =>
  (db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined)
    ?.value ?? null

export const setMeta = (key: string, value: string) =>
  db
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
