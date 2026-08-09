import { NextResponse } from 'next/server'
import { ADMIN_COOKIE, adminEnabled, tokenMatches } from '@/lib/admin'

export async function POST(req: Request) {
  if (!adminEnabled()) return new NextResponse('Panel deshabilitado', { status: 404 })

  const form = await req.formData()
  const token = String(form.get('token') ?? '')

  if (!tokenMatches(token)) {
    return NextResponse.redirect(new URL('/admin?error=1', req.url), { status: 303 })
  }

  const res = NextResponse.redirect(new URL('/admin', req.url), { status: 303 })
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
