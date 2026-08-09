import { NextResponse } from 'next/server'
import { createWriteStream, existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import Database from 'better-sqlite3'
import { DB_PATH, INCOMING_PATH } from '@/db/index'
import { adminEnabled, isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PART_PATH = `${INCOMING_PATH}.part`

/** Tablas que tiene que traer cualquier base nuestra para considerarla válida. */
const REQUIRED = ['products', 'prices', 'expansions', 'price_history']

/**
 * Sube una base ya construida al volumen.
 *
 *   gzip -c data/pokevault.sqlite > db.gz
 *   curl -X POST https://<tu-app>/api/admin/restore \
 *        -H "Cookie: pc_admin=<token>" \
 *        --data-binary @db.gz
 *
 * NO reemplaza la base en caliente: cambiarla con la conexión abierta la
 * corrompe. La deja preparada como `.incoming` y el intercambio lo hace
 * `src/db/index.ts` en el siguiente arranque. Así que después de subirla hay
 * que reiniciar el servicio (un clic en Railway).
 */
export async function POST(req: Request) {
  if (!adminEnabled()) return new NextResponse('No disponible', { status: 404 })
  if (!(await isAdmin())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!req.body) return NextResponse.json({ error: 'Cuerpo vacío' }, { status: 400 })

  rmSync(PART_PATH, { force: true })

  // Aceptamos el fichero tal cual o comprimido con gzip: 26 MB bajan a ~8.
  const gzipped = (req.headers.get('content-encoding') ?? '').includes('gzip')
  const source = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0])

  try {
    if (gzipped) {
      await pipeline(source, createGunzip(), createWriteStream(PART_PATH))
    } else {
      await pipeline(source, createWriteStream(PART_PATH))
    }
  } catch (err) {
    rmSync(PART_PATH, { force: true })
    return NextResponse.json(
      { error: `No se pudo recibir el fichero: ${(err as Error).message}` },
      { status: 400 },
    )
  }

  // ── Fase 1: validar. Una base corrupta aquí tumbaría el próximo arranque.
  let counts: { p: number; pr: number }
  try {
    const probe = new Database(PART_PATH, { readonly: true, fileMustExist: true })
    try {
      const tables = new Set(
        (probe.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
          name: string
        }[]).map((t) => t.name),
      )
      const missing = REQUIRED.filter((t) => !tables.has(t))
      if (missing.length) throw new Error(`faltan tablas: ${missing.join(', ')}`)

      counts = probe
        .prepare(`SELECT (SELECT COUNT(*) FROM products) p, (SELECT COUNT(*) FROM prices) pr`)
        .get() as { p: number; pr: number }
      if (!counts.p) throw new Error('no tiene productos')
    } finally {
      // Cerrar SIEMPRE antes de tocar el fichero: con la conexión abierta,
      // Windows bloquea el renombrado y en Linux te llevas los sidecars.
      probe.close()
    }
  } catch (err) {
    cleanupPart()
    return NextResponse.json(
      { error: `El fichero no es una base de PokeVault válida: ${(err as Error).message}` },
      { status: 400 },
    )
  }

  // ── Fase 2: colocarla, ya sin nada abierto.
  try {
    const size = statSync(PART_PATH).size
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${INCOMING_PATH}${suffix}`, { force: true })
    }
    renameSync(PART_PATH, INCOMING_PATH)
    // Los sidecars que dejó la validación no sirven para nada: la base subida
    // ya trae su contenido consolidado y el próximo arranque abre en limpio.
    for (const suffix of ['-wal', '-shm']) {
      rmSync(`${PART_PATH}${suffix}`, { force: true })
    }

    return NextResponse.json({
      ok: true,
      productos: counts.p,
      precios: counts.pr,
      bytes: size,
      siguiente: 'Reinicia el servicio para que la base se coloque en su sitio.',
    })
  } catch (err) {
    cleanupPart()
    return NextResponse.json(
      { error: `No se pudo colocar la base: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}

/** Borra el fichero a medias y los sidecars que haya dejado la validación. */
function cleanupPart() {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${PART_PATH}${suffix}`, { force: true })
  }
}

/** Para comprobar si hay una subida esperando al próximo reinicio. */
export async function GET() {
  if (!adminEnabled()) return new NextResponse('No disponible', { status: 404 })
  if (!(await isAdmin())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  return NextResponse.json({
    destino: DB_PATH,
    subidaPendiente: existsSync(INCOMING_PATH)
      ? { bytes: statSync(INCOMING_PATH).size, aplicaEn: 'el próximo reinicio' }
      : null,
  })
}
