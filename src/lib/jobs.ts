/**
 * Tareas de mantenimiento, lanzables desde el panel o encadenadas tras la
 * ingesta diaria.
 *
 * Corren en segundo plano dentro del propio servicio: la petición HTTP crea la
 * tarea y contesta al momento, y el panel va preguntando cómo va. Se guarda
 * todo en la tabla `jobs` para poder seguirlo desde la web sin mirar logs.
 *
 * Solo una a la vez. Dos de estas escribiendo sobre las mismas tablas se
 * pisarían, y además ninguna gana nada por ir en paralelo: el cuello de
 * botella son las peticiones a TCGdex, no la CPU.
 */
import { db } from '../db/index'
import { runIngest } from './ingest'
import { runMapSets } from './map-sets'
import { runRefreshSets } from './refresh-sets'
import { runNamesEn } from './names-en'
import { runClassify } from './classify'
import { runBackfillImages } from './backfill-images'
import { JOB_NAMES, type JobName, type JobRow } from './jobs-shared'

export { JOB_NAMES, JOB_LABELS } from './jobs-shared'
export type { JobName, JobRow } from './jobs-shared'

/** Una tarea a la vez en todo el proceso. */
let corriendo: JobName | null = null

export const jobEnCurso = () => corriendo

/**
 * El mantenimiento completo, en el orden en que se necesitan: primero se
 * identifican las expansiones nuevas, luego se les pone nombre inglés si son
 * japonesas, se reclasifican y por último se bajan sus imágenes.
 */
async function runMantenimiento(log: (msg: string) => void) {
  log('Identificando expansiones nuevas...')
  const mapped = await runMapSets(log)

  // Solo los que no tienen logo: son los únicos que pueden mejorar.
  log('Refrescando datos de sets sin logo...')
  await runRefreshSets(log, { soloSinLogo: true })

  log('Buscando nombres oficiales en inglés...')
  await runNamesEn(log)

  log('Clasificando...')
  runClassify(log)

  // Un set nuevo son ~200 peticiones; el tope evita que un arranque en frío se
  // convierta en 40.000 de golpe. Si quedan más, se van haciendo cada día.
  log('Descargando imágenes...')
  const images = await runBackfillImages(log, 12)

  log(`Listo: ${mapped.mapped} expansiones nuevas, ${images.images} imágenes`)
}

const RUNNERS: Record<JobName, (log: (msg: string) => void) => Promise<void> | void> = {
  ingest: async (log) => {
    const r = await runIngest(log)
    if (r.status === 'error') throw new Error(r.error)
  },
  'map-sets': async (log) => void (await runMapSets(log)),
  'refresh-sets': async (log) => void (await runRefreshSets(log)),
  'names-en': async (log) => void (await runNamesEn(log)),
  classify: (log) => void runClassify(log),
  'backfill-images': async (log) => void (await runBackfillImages(log, 12)),
  mantenimiento: runMantenimiento,
}

/**
 * Arranca una tarea en segundo plano. Devuelve su id al momento; el resultado
 * se consulta luego en la tabla `jobs`.
 */
export function startJob(name: JobName, trigger: 'manual' | 'auto' = 'manual'): number | null {
  if (corriendo) return null

  corriendo = name
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO jobs (name, started_at, status, trigger) VALUES (?, ?, 'running', ?)`)
    .run(name, new Date().toISOString(), trigger)
  const id = Number(lastInsertRowid)

  const setDetail = db.prepare(`UPDATE jobs SET detail = ? WHERE id = ?`)
  const log = (msg: string) => {
    console.log(`[${name}] ${msg}`)
    try {
      setDetail.run(msg, id)
    } catch {
      /* el progreso es informativo: si falla, la tarea sigue */
    }
  }

  void (async () => {
    try {
      await RUNNERS[name](log)
      db.prepare(`UPDATE jobs SET finished_at = ?, status = 'ok' WHERE id = ?`).run(
        new Date().toISOString(),
        id,
      )
    } catch (err) {
      const message = (err as Error).message
      console.error(`[${name}] ERROR: ${message}`)
      db.prepare(`UPDATE jobs SET finished_at = ?, status = 'error', error = ? WHERE id = ?`).run(
        new Date().toISOString(),
        message,
        id,
      )
    } finally {
      corriendo = null
    }
  })()

  return id
}

export const listJobs = (limit = 8) =>
  db.prepare(`SELECT * FROM jobs ORDER BY id DESC LIMIT ?`).all(limit) as JobRow[]

/**
 * ¿Hay expansiones nuevas sin identificar? Es lo que dispara el mantenimiento
 * automático después de una ingesta: si Cardmarket ha metido un set nuevo,
 * aparecen expansiones sin nombre y hay trabajo que hacer.
 */
export function hayTrabajoPendiente(): boolean {
  const r = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM expansions WHERE tcgdex_set_id IS NULL) AS sinNombre,
         (SELECT COUNT(*) FROM expansions
           WHERE tcgdex_set_id IS NOT NULL
             AND tcgdex_set_id NOT IN (SELECT tcgdex_set_id FROM image_backfill)) AS sinImagenes`,
    )
    .get() as { sinNombre: number; sinImagenes: number }
  return r.sinNombre > 0 || r.sinImagenes > 0
}
