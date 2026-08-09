/**
 * ¿Dónde vive la base y sobrevive a un despliegue?
 *
 * Es la pregunta que más cara sale equivocada: si el fichero está en el disco
 * del contenedor y no en un volumen, cada despliegue se lleva por delante el
 * histórico de precios, que es lo único que no se puede reconstruir. Y no se
 * nota hasta que ya lo has perdido.
 *
 * Railway publica `RAILWAY_VOLUME_MOUNT_PATH` cuando hay un volumen montado en
 * el servicio, así que se puede comprobar de verdad en vez de suponerlo.
 */
import { join, posix, resolve, sep } from 'node:path'

/** El volumen siempre es una ruta de Linux: nunca la construyas con `join`. */
const enVolumen = (mount: string) => posix.join(mount, 'pokevault.sqlite')

export type Persistencia = 'volumen' | 'efimero' | 'local'

export interface EstadoAlmacen {
  persistencia: Persistencia
  dbPath: string
  volumeMountPath: string | null
  /** Qué habría que poner en DB_PATH para arreglarlo, si está mal. */
  sugerencia: string | null
}

const enRailway = () => Boolean(process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.RAILWAY_SERVICE_ID)

/** ¿Está `hijo` dentro de `padre`? */
function dentroDe(hijo: string, padre: string) {
  const a = resolve(padre).replace(/[/\\]+$/, '')
  const b = resolve(hijo)
  return b === a || b.startsWith(a + sep) || b.startsWith(a + '/')
}

/**
 * Ruta por defecto de la base.
 *
 * Si hay volumen montado y nadie ha dicho otra cosa, la base va al volumen.
 * Así el despliegue funciona bien sin tener que acordarse de poner DB_PATH.
 */
export function rutaPorDefecto(): string {
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH
  if (mount) return enVolumen(mount)
  return join(process.cwd(), 'data', 'pokevault.sqlite')
}

export function estadoAlmacen(dbPath: string): EstadoAlmacen {
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? null

  if (!enRailway()) {
    return { persistencia: 'local', dbPath, volumeMountPath: mount, sugerencia: null }
  }

  if (mount && dentroDe(dbPath, mount)) {
    return { persistencia: 'volumen', dbPath, volumeMountPath: mount, sugerencia: null }
  }

  // En Railway y fuera del volumen: los datos se pierden en cada despliegue.
  return {
    persistencia: 'efimero',
    dbPath,
    volumeMountPath: mount,
    sugerencia: mount
      ? `DB_PATH=${enVolumen(mount)}`
      : 'Añade un volumen al servicio en Railway (por ejemplo montado en /data).',
  }
}
