import { NextResponse } from 'next/server'
import { adminEnabled, isAdmin } from '@/lib/admin'
import { JOB_NAMES, jobEnCurso, listJobs, startJob, type JobName } from '@/lib/jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function guard() {
  if (!adminEnabled()) return new NextResponse('No disponible', { status: 404 })
  if (!(await isAdmin())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  return null
}

/** Estado de las tareas, para que el panel lo vaya refrescando. */
export async function GET() {
  const no = await guard()
  if (no) return no

  return NextResponse.json({ enCurso: jobEnCurso(), tareas: listJobs(8) })
}

/** Lanza una tarea. Contesta al momento: el trabajo sigue en segundo plano. */
export async function POST(req: Request) {
  const no = await guard()
  if (no) return no

  const { name } = (await req.json().catch(() => ({}))) as { name?: string }
  if (!name || !JOB_NAMES.includes(name as JobName)) {
    return NextResponse.json({ error: 'Tarea desconocida' }, { status: 400 })
  }

  const id = startJob(name as JobName)
  if (id === null) {
    return NextResponse.json(
      { error: `Ya hay una tarea en marcha (${jobEnCurso()}). Espera a que termine.` },
      { status: 409 },
    )
  }

  return NextResponse.json({ ok: true, id })
}
