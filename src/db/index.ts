import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data', 'pokevault.sqlite')

mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

/**
 * Esquema. SQL estándar a propósito: mover esto a Postgres en Railway es
 * cambiar INTEGER PRIMARY KEY por BIGINT y poco más.
 */
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
`)

/** Añade una columna solo si aún no existe. Evita tener que borrar la base. */
function addColumn(table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

// Idioma de TCGdex en el que se resolvió el set ('es' | 'en' | 'ja'). Lo usamos
// para saber qué sets son japoneses y buscarles el nombre oficial en inglés.
addColumn('expansions', 'lang', 'TEXT')
addColumn('expansions', 'name_en', 'TEXT')

// Qué clase de "expansión" es realmente. Cardmarket mete en el mismo saco los
// sets de verdad y un montón de agrupaciones que no lo son. Ver `classify.ts`.
addColumn('expansions', 'kind', 'TEXT')

// Imagen y carta de TCGdex asociadas al producto de Cardmarket.
addColumn('products', 'image', 'TEXT')
addColumn('products', 'tcgdex_card_id', 'TEXT')

// Marca de qué sets ya tienen las imágenes de sus cartas descargadas.
db.exec(`
CREATE TABLE IF NOT EXISTS image_backfill (
  tcgdex_set_id TEXT PRIMARY KEY,
  done_at       TEXT,
  matched       INTEGER,
  total         INTEGER
);
`)
