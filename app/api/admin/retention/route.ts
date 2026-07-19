import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'

export type RetentionRow = {
  quizId: string
  title: string
  opensAt: string | null
  players: number
  returned: number | null
  retentionPct: number | null
}

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Alle quizer i kronologisk rekkefølge etter når de åpnet.
  const { data: quizzes, error: quizErr } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at')
    .not('opens_at', 'is', null)
    .order('opens_at', { ascending: true })

  if (quizErr) return NextResponse.json({ error: quizErr.message }, { status: 500 })

  // Kun innloggede, fullførte attempts.
  const { data: attempts, error: attErr } = await supabaseAdmin
    .from('attempts')
    .select('quiz_id, user_id')
    .not('user_id', 'is', null)
    .not('submitted_at', 'is', null)

  if (attErr) return NextResponse.json({ error: attErr.message }, { status: 500 })

  // quiz_id → sett av unike user_id som fullførte.
  const playersByQuiz = new Map<string, Set<string>>()
  for (const a of attempts ?? []) {
    if (!a.quiz_id || !a.user_id) continue
    let set = playersByQuiz.get(a.quiz_id)
    if (!set) { set = new Set(); playersByQuiz.set(a.quiz_id, set) }
    set.add(a.user_id)
  }

  const ordered = quizzes ?? []
  const rows: RetentionRow[] = ordered.map((quiz, i) => {
    const players = playersByQuiz.get(quiz.id) ?? new Set<string>()
    // Retention vises på DENNE quizens rad, men måles bakover mot FORRIGE quiz
    // (kronologisk før). Dette gir et ekte tall på nyeste rad i stedet for at
    // det henger på raden for quizen FØR — se retention-kartleggingen 20. juli.
    // Selve definisjonen er uendret: retention = hvor stor andel av FORRIGE
    // quiz sine spillere som kom tilbake denne gangen. Nevneren er derfor
    // forrige quiz sitt spillertall (prevPlayers.size), ikke denne quizens —
    // ellers hadde tallet målt noe annet ("andel av dagens spillere som er
    // tilbakevendende"), ikke klassisk retention.
    const prev = ordered[i - 1]
    const prevPlayers = prev ? (playersByQuiz.get(prev.id) ?? new Set<string>()) : null

    let returned: number | null = null
    let retentionPct: number | null = null
    if (prevPlayers) {
      returned = 0
      for (const uid of players) if (prevPlayers.has(uid)) returned++
      retentionPct = prevPlayers.size > 0 ? Math.round((returned / prevPlayers.size) * 100) : 0
    }

    return {
      quizId: quiz.id,
      title: quiz.title,
      opensAt: quiz.opens_at,
      players: players.size,
      returned,
      retentionPct,
    }
  })

  // Nyeste øverst i tabellen.
  rows.reverse()

  return NextResponse.json({ rows })
}
