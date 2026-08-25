import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankAttempts } from '@/lib/ranking'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  // Låst org: plassering i bedrifts-topplisten er en del av bedriftsproduktet.
  const lock = await requireUnlockedOrg({ slug })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

  const { data: members } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)

  const memberUserIds = (members ?? []).map(m => m.user_id).filter(Boolean)
  if (memberUserIds.length === 0) return NextResponse.json({ placement: null })

  // ── Vinduet «de siste quizene» — TO avgrensninger, av to ulike grunner ─────
  //
  // 1. onlyRealQuizzes — GULVET. Uten det kan en testquiz et medlem har spilt
  //    vinne løkken, og en Elkjøp-ansatt får «Din plassering på [TEST – ikke
  //    ekte] …» med et deltakertall hentet fra testkjøringen. Se
  //    lib/real-quiz-population.ts.
  //
  // 2. `.lte('opens_at', now)` — DET GULVET IKKE DEKKER. En planlagt quiz er en
  //    helt ordinær `weekly`-rad og passerer hvitelisten uten videre. Den kan
  //    riktignok ikke ha forsøk (start-attempt svarer 403 før opens_at), men
  //    det er nettopp derfor den er skadelig HER: løkken hopper over den med
  //    `continue`, mens raden allerede har spist en av de ti plassene. Antallet
  //    planlagte quizer i prod er ikke målt i denne runden — lib/history.ts:346
  //    noterte 6 stykker per 2. august 2026, og med et slikt tall pluss en
  //    testquiz er 7 av 10 plasser døde. Da faller en ekte plassering lenger
  //    tilbake ut av vinduet, og utfallet er `placement: null`: flaten viser
  //    ingenting, som om medlemmet aldri hadde spilt. Stille, ikke en feilmelding.
  //
  // Formen er hentet, ikke oppfunnet: `.not('opens_at','is',null)` +
  // `.lte('opens_at', nowIso)` er samme par som lib/history.ts:384-385,
  // app/api/quiz/active/route.ts:19 og cron/publish-quiz:70 bruker for «har
  // åpnet». `.not(… is null)` er strengt tatt overflødig — en NULL kan ikke
  // tilfredsstille `lte` — men står eksplisitt fordi det å holde utkast uten
  // åpningstid ute er en beslutning, ikke en bieffekt av trevalgt logikk.
  //
  // Spørringen står i en LOKAL VARIABEL: inlinet som argument til
  // onlyRealQuizzes() ga `next build` TS2589 «Type instantiation is
  // excessively deep». Se lib/real-quiz-population.ts. Ikke inline den tilbake.
  const nowIso = new Date().toISOString()
  const quizWindowQuery = supabaseAdmin
    .from('quizzes')
    .select('id, title, created_at')
    .not('opens_at', 'is', null)
    .lte('opens_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(10)

  const { data: quizzes } = await onlyRealQuizzes(quizWindowQuery)

  for (const q of (quizzes ?? [])) {
    const { data: qAttempts } = await supabaseAdmin
      .from('attempts')
      .select('id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, user_id, completed_at, is_team, team_size')
      .eq('quiz_id', q.id)
      .in('user_id', memberUserIds)

    if (!qAttempts || qAttempts.length === 0) continue

    const ranked = rankAttempts(qAttempts as Parameters<typeof rankAttempts>[0])
    const mine = ranked.filter(a => (a as unknown as { user_id: string }).user_id === user.id)
    const myBest = mine.length > 0 ? mine.reduce((best, a) => a.rank < best.rank ? a : best) : null

    // rank: number → brukeren spilte og fikk denne plasseringen
    // rank: null   → quiz har aktivitet fra andre, men brukeren spilte ikke
    return NextResponse.json({
      placement: {
        rank: myBest ? myBest.rank : null,
        total: ranked.length,
        quizTitle: q.title as string,
      },
    })
  }

  return NextResponse.json({ placement: null })
}
