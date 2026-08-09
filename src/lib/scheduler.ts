/**
 * Planificador de la ingesta diaria, dentro del propio servicio web.
 *
 * ¿Por qué aquí y no como cron aparte? Porque un volumen de Railway solo se
 * puede montar en UN servicio. La base vive en el volumen que tiene montado la
 * web, así que un cron separado no la vería. Cuando pasemos a Postgres esto se
 * podrá sacar a su propio servicio y borrar este fichero.
 *
 * ¿Y por qué no `instrumentation.ts`, que es lo suyo? Porque Next compila la
 * instrumentación también para el runtime edge y arrastra ahí `better-sqlite3`,
 * que es un binario nativo y revienta el build. La variante
 * `instrumentation.node.ts` directamente no se ejecuta. Así que se arranca
 * desde el layout, que es servidor puro y sí corre en Node.
 *
 * Cómo evita gastar ancho de banda: el price guide son 15 MB, pero el bucket
 * de Cardmarket devuelve `ETag`. Cada hora hacemos una petición HEAD de unos
 * cientos de bytes y solo bajamos el fichero cuando el ETag ha cambiado.
 *
 * La ingesta es idempotente por su cuenta (compara el `createdAt` del volcado),
 * así que aunque el ETag nos engañe no se ensucia nada.
 */
import { getMeta, setMeta } from '../db/index'
import { peekPrices } from './cardmarket'
import { runIngest } from './ingest'

/** Cada cuánto miramos si hay volcado nuevo. */
const CHECK_EVERY_MS = 60 * 60 * 1000

/** Margen tras arrancar, para no competir con el primer tráfico. */
const FIRST_CHECK_MS = 30 * 1000

const ETAG_KEY = 'price_guide_etag'

/** El módulo es un singleton, pero en desarrollo se recarga: guarda extra. */
let started = false

const log = (msg: string) => console.log(`[ingesta] ${msg}`)

async function check() {
  try {
    const { etag } = await peekPrices()
    const seen = getMeta(ETAG_KEY)

    if (etag && seen === etag) return // nada nuevo, ni un byte descargado

    const result = await runIngest(log)

    if (result.status === 'ok') {
      log(
        `volcado ${result.createdAt} · ${result.changed?.toLocaleString('es')} cambios en ${result.seconds}s`,
      )
    } else if (result.status === 'error') {
      log(`ERROR: ${result.error}`)
    }

    // El ETag solo se guarda si la ingesta no falló: si falló, queremos que el
    // siguiente intento se lo vuelva a bajar en vez de darlo por procesado.
    if (etag && result.status !== 'error') setMeta(ETAG_KEY, etag)
  } catch (err) {
    log(`ERROR inesperado: ${(err as Error).message}`)
  }
}

export function startScheduler() {
  if (started) return
  // En local estorba: se activa en producción, o a mano con SCHEDULER=on.
  const enabled =
    process.env.SCHEDULER === 'on' ||
    (process.env.NODE_ENV === 'production' && process.env.SCHEDULER !== 'off')
  if (!enabled) return

  started = true
  log(`activado · comprueba cada ${CHECK_EVERY_MS / 60000} min`)

  const timer = setTimeout(() => {
    void check()
    setInterval(() => void check(), CHECK_EVERY_MS).unref()
  }, FIRST_CHECK_MS)
  timer.unref() // que no impida al proceso terminar si Railway lo para
}
