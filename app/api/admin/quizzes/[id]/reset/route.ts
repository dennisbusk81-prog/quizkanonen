import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const { data: attempts, error: attemptsFetchErr } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('quiz_id', id)
  if (attemptsFetchErr) {
    console.error('[quiz-reset] kunne ikke hente forsøk', id, attemptsFetchErr)
    return NextResponse.json({ error: 'Nullstilling feilet (attempts-oppslag). Prøv igjen.' }, { status: 500 })
  }
  const attemptIds = (attempts ?? []).map(a => a.id)

  // Sekvensiell for-løkke, ikke ubevoktede await-kall: en feilet sletting skal
  // stoppe her med en feilrespons, ikke passere stille. Uten dette kunne en
  // mislykket sletting av gamle attempts la start-attempt sin replay-sperre
  // avvise et nytt forsøk med en forvirrende «du har allerede spilt»-feil, mens
  // admin trodde nullstillingen gikk bra. Samme steg-array-mønster som
  // app/api/profile/delete/route.ts og app/api/org/[slug]/delete/route.ts.
  const steps: { table: string; run: () => PromiseLike<{ error: { message: string } | null }> }[] = [
    ...(attemptIds.length > 0
      ? [
          { table: 'attempt_answers', run: () => supabaseAdmin.from('attempt_answers').delete()
              .in('attempt_id', attemptIds) },
          { table: 'attempts', run: () => supabaseAdmin.from('attempts').delete()
              .eq('quiz_id', id) },
        ]
      : []),
    { table: 'played_log', run: () => supabaseAdmin.from('played_log').delete()
        .eq('quiz_id', id) },
  ]

  for (const step of steps) {
    const { error } = await step.run()
    if (error) {
      console.error(`[quiz-reset] nullstilling feilet på steg "${step.table}"`, id, error)
      return NextResponse.json(
        { error: `Nullstilling feilet (${step.table}). Prøv igjen.` },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ ok: true })
}
