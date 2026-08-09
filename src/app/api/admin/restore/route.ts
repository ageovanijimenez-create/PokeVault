import { NextResponse } from 'next/server'
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import Database from 'better-sqlite3'
import { DB_PATH, INCOMING_PATH } from '@/db/index'
import { adminEnabled, isAdmin } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PART_PATH = `${INCOMING_PATH}.part`
const RAW_PATH = `${INCOMING_PATH}.raw`

/** Tablas que tiene que traer cualquier base nuestra para considerarla válida. */
const REQUIRED = ['products', 'prices', 'expansions', 'price_history']

/**
 * Sube una base ya construida al volumen.
 *
 * Se usa desde el formulario del panel, o a mano:
 *
 *   curl -X POST https://<tu-app>/api/admin/restore \
 *        -H "Cookie: pc_admin=<token>" --data-binary @pokevault.sqlite
 *
 * Acepta el fichero tal cual o comprimido con gzip, y da igual cómo llegue:
 * lo detecta por los bytes del propio fichero.
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

  cleanupPart()

  // Dos formas de llegar aquí: el formulario del panel (multipart) o un curl
  // con el fichero en crudo. Aceptamos las dos.
  try {
    const contentType = req.headers.get('content-type') ?? ''
    let source: Readable

    if (contentType.includes('multipart/form-data')) {
      const file = (await req.formData()).get('db')
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: 'No has elegido ningún fichero' }, { status: 400 })
      }
      source = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0])
    } else {
      source = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0])
    }

    await pipeline(source, createWriteStream(RAW_PATH))
  } catch (err) {
    cleanupPart()
    return NextResponse.json(
      { error: `No se pudo recibir el fichero: ${(err as Error).message}` },
      { status: 400 },
    )
  }

  // ¿Viene comprimido? Lo decidimos por los bytes mágicos del gzip (1f 8b) y
  // no por la cabecera: el navegador no manda Content-Encoding al subir un
  // fichero, así que da igual por dónde haya entrado.
  try {
    const magic = Buffer.alloc(2)
    const fd = openSync(RAW_PATH, 'r')
    try {
      readSync(fd, magic, 0, 2, 0)
    } finally {
      closeSync(fd)
    }

    if (magic[0] === 0x1f && magic[1] === 0x8b) {
      await pipeline(createReadStream(RAW_PATH), createGunzip(), createWriteStream(PART_PATH))
      rmSync(RAW_PATH, { force: true })
    } else {
      renameSync(RAW_PATH, PART_PATH)
    }
  } catch (err) {
    cleanupPart()
    return NextResponse.json(
      { error: `El fichero está comprimido pero no se pudo abrir: ${(err as Error).message}` },
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

/** Borra los ficheros a medias y los sidecars que haya dejado la validación. */
function cleanupPart() {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${PART_PATH}${suffix}`, { force: true })
  }
  rmSync(RAW_PATH, { force: true })
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
