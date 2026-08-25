import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { rankAttempts } from '@/lib/ranking'
import { requireUnlockedOrg } from '@/lib/org-lock-guard'
import { fetchAllRowsChunked } from '@/lib/paginate'
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
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const rlKey = `org-dashboard:${ip}`
  if (!rateLimit(rlKey, 30, 60_000).success) {
    logRateLimitHit(rlKey, { lag: 'lokal', limit: 30, windowMs: 60_000 })
    return NextResponse.json({ error: 'For mange forespørsler' }, { status: 429 })
  }

  const bearerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!bearerToken) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(bearerToken)
  if (authErr || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  const { slug } = await params

  // Get org
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, plan')
    .eq('slug', slug)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  // Verify membership
  const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 })

  // Låst org: bedrifts-dashbordet er det betalte produktet.
  const lock = await requireUnlockedOrg({ slug })
  if (!lock.ok) return NextResponse.json(lock.body, { status: lock.status })

  // Get all member user_ids
  const { data: members } = await supabaseAdmin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)

  const memberUserIds = (members ?? []).map(m => m.user_id).filter(Boolean)
  if (memberUserIds.length === 0) {
    return NextResponse.json({ org: { name: org.name, plan: org.plan }, quiz: null, attempts: [], userRole: membership.role })
  }

  // Del 2 (Disk IO) — to-trinns i stedet for å hente ALLE medlems-attempts på
  // tvers av hele historikken (10 kolonner) bare for å finne siste quiz:
  //   1. Distinkte quiz-id-er medlemmene har spilt — indeks-only scan via
  //      (user_id, quiz_id)-indeksen (smal kolonne, ingen heap-lesing).
  //   2. Nyeste quiz etter created_at (samme kriterium som før).
  //   3. Hent KUN den quizens medlems-attempts (målrettet via quiz_id-indeks).
  // Output er identisk med før — kun mindre data leses.
  // Steg 1 går via fetchAllRowsChunked: .in()-listen over medlemmer treffer
  // URL-taket ved ~390 id-er, og radene (én per forsøk) kuttes ellers stille
  // ved 1000 (PostgREST db-max-rows). Spørringen hadde dessuten ingen order,
  // så et kutt kunne la en GAMMEL quiz vinne som «siste» — det eneste av
  // paginerings-funnene 18. august 2026 med en annen feilretning enn «for
  // lavt tall». [...new Set()] er idempotent, så pagineringen endrer ikke
  // resultatet; .order('id') er kun der for stabile pagineringsvinduer.
  const memberQuizRows = await fetchAllRowsChunked<{ quiz_id: string | null }>(
    memberUserIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from('attempts')
        .select('quiz_id')
        .in('user_id', chunk)
        .order('id')
        .range(from, to)
  ).catch((err): { quiz_id: string | null }[] => {
    // Samme degradering som før (feil ble ignorert → tom liste → quiz: null),
    // nå med loggspor. Aldri et DELVIS sett: feiler en senere side, forkastes alt.
    console.error('[org-dashboard] attempts-oppslag feilet:', err)
    return []
  })

  const playedQuizIds = [...new Set(memberQuizRows.map(r => r.quiz_id as string).filter(Boolean))]

  let quiz: { id: string; title: string; is_active: boolean } | null = null
  let attempts: unknown[] = []

  if (playedQuizIds.length > 0) {
    // onlyRealQuizzes — samme klasse som «Deltakere siste quiz» i
    // admin/dashboard (f4d4a07). Uten det overtar en testquiz kortet så snart
    // ETT medlem har spilt den: en testquiz er fersk, så den vinner
    // `order('created_at', desc)`, og bedriftens «Siste quiz» viser da
    // testtittelen med de to–tre radene testkjøringen la igjen.
    //
    // Framtids-avgrensningen fra my-placement er BEVISST IKKE med her.
    // `playedQuizIds` kommer fra medlemmenes `attempts`, og et forsøk finnes
    // bare på en quiz som har åpnet (start-attempt svarer 403 før opens_at).
    // En planlagt quiz kan altså ikke nå denne `.in()`-listen i det hele tatt
    // — `.lte('opens_at', now)` ville vært et filter uten noe å filtrere.
    //
    // Spørringen står i en LOKAL VARIABEL: inlinet som argument til
    // onlyRealQuizzes() ga `next build` TS2589 «Type instantiation is
    // excessively deep». Se lib/real-quiz-population.ts. Ikke inline den tilbake.
    const latestQuizQuery = supabaseAdmin
      .from('quizzes')
      .select('id, title, is_active, created_at')
      .in('id', playedQuizIds)
      .order('created_at', { ascending: false })
      .limit(1)

    // Helperen MÅ stå før `.maybeSingle()` — den returnerer en
    // PostgrestBuilder som ikke lenger har `.not()`/`.in()`.
    const { data: latest } = await onlyRealQuizzes(latestQuizQuery).maybeSingle()

    if (latest) {
      quiz = { id: latest.id, title: latest.title, is_active: latest.is_active }
      // Samme kolonner og samme populasjon (ingen is_team-filter) som før, kun
      // begrenset til siste quiz — så rankAttempts gir identisk resultat.
      // Chunket av samme grunn som steg 1: det er den SAMME medlemslisten i
      // .in(), så hvis steg 1 kunne sprenge URL-taket, kunne dette også.
      const latestAttempts = await fetchAllRowsChunked<Record<string, unknown>>(
        memberUserIds,
        (chunk, from, to) =>
          supabaseAdmin
            .from('attempts')
            .select('id, player_name, correct_answers, total_questions, total_time_ms, correct_streak, user_id, completed_at, is_team, team_size')
            .eq('quiz_id', latest.id)
            .in('user_id', chunk)
            .order('id')
            .range(from, to)
      ).catch((err): Record<string, unknown>[] => {
        console.error('[org-dashboard] latest-attempts-oppslag feilet:', err)
        return []
      })
      attempts = latestAttempts
    }
  }

  const ranked = attempts.length > 0 ? rankAttempts(attempts as Parameters<typeof rankAttempts>[0]) : []

  return NextResponse.json({
    org: { name: org.name, plan: org.plan },
    quiz,
    attempts: ranked,
    userRole: membership.role,
    currentUserId: user.id,
  })
}
