import { cookies } from 'next/headers'
import { timingSafeEqual } from 'node:crypto'

export const ADMIN_COOKIE = 'pc_admin'

/**
 * El panel solo existe si hay un ADMIN_TOKEN configurado. Sin variable de
 * entorno no hay panel: falla cerrado, que es como debe fallar esto.
 */
export const adminEnabled = () => Boolean(process.env.ADMIN_TOKEN)

/** Comparación en tiempo constante, para no filtrar el token carácter a carácter. */
export function tokenMatches(given: string): boolean {
  const expected = process.env.ADMIN_TOKEN
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies()
  return tokenMatches(store.get(ADMIN_COOKIE)?.value ?? '')
}
