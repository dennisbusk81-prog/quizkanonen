import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUserPremium } from '@/lib/premium-check'
import { fetchAllRows } from '@/lib/paginate'
import { resolveOrgMembership } from '@/lib/org-membership'
import { getGloballyBlockedSet } from '@/lib/globally-blocked-set'
import { decideArchivePlayGate } from '@/lib/archive-play-gate'
import { decideArchivePlacement, type ArchiveFieldRow } from '@/lib/archive-placement'

// ── GET /api/arkiv/[id]/plassering — «slik ville du havnet den uken» ────────
//
// [ARK-1] steg 1B, 27. august 2026. Spillerens arkivscore målt mot det
// ORIGINALE feltet fra den fredagen — ikke mot hennes eget gamle resultat
// (det måler hukommelse, ikke ferdighet).
//
// ── INVARIANTEN: BEREGNING, IKKE RAD ───────────────────────────────────────
// Plasseringen REGNES UT ved hvert kall og LAGRES INGEN STEDER. Ruten er
// ren lesing: den skriver ikke til `attempts`, ikke til `season_scores`, og
// ikke til `ranking_snapshots`.
//
// At `ranking_snapshots` er urørt er et BEVISST valg, ikke en forglemmelse.
// `getOrBuildSnapshot()` ville gitt nøyaktig samme felt med færre linjer —
// men den SKRIVER en cache-rad (10 s TTL) for quizen den leser. Feltet her
// er frosset: quizen stengte for uker siden og kan ikke endre seg, så
// cachen ville aldri gitt noe igjen, mens hver visning av en gammel quiz
// hadde kostet en JSONB-UPDATE på nettopp den tabellen som var
// Disk IO-hovedårsaken 19. juli. Feltet bygges derfor med samme
// rangeringsfunksjon (`rankQuizAttempts` inne i lib/archive-placement.ts),
// men uten cachelaget.
//
// ── ARKIVET HAR INGEN TOPPLISTE ────────────────────────────────────────────
// Ingen som spiller arkiv skal dukke opp i noen offentlig liste, hverken
// B2C eller org. To lag sikrer det allerede: toppliste per quiz er nøklet på
// quiz-id (arkivkopien har sin egen), og hvitelisten i
// lib/real-quiz-population.ts stopper resten. Denne ruten innfører ingen
// tredje vei: den LESER originalquizens felt og SKRIVER ingenting, og den
// returnerer kun tall — ingen navn, ingen liste, ingen naboer over/under.
//
// ── GATEN ER DEN SAMME SOM SPILL-PORTEN ────────────────────────────────────
// `decideArchivePlayGate` gjenbrukes med vilje: arkivet er en betalt flate,
// og «vet ikke» er 503 — aldri en dom (Dennis-retning 27. august). Én regel,
// ett sted; ruten gjentar den ikke.
//
// Ingen rate-limit, samme linje som /api/leaderboard/[id] og /api/toppliste:
// ren lesing mot egen DB, og kalleren er allerede autentisert OG Premium, så
// grensen ville kun vært kostnadsdemping.

// Lese-rute: kun egen DB. 15 s dekker kald start med god margin og dreper et
// hengende Supabase-kall tidlig — samme budsjett som resten av arkivrutene.
export const maxDuration = 15

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Feltkolonnene rangeringen trenger. `submitted_at` er ferdig-definisjonen. */
const FIELD_SELECT =
  'id, user_id, player_name, correct_answers, total_time_ms, correct_streak, submitted_at'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: archiveQuizId } = await context.params
  if (!archiveQuizId || !UUID_RE.test(archiveQuizId)) {
    return NextResponse.json({ error: 'Ugyldig quiz-id.' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const attemptId = searchParams.get('attempt')?.trim() ?? ''
  if (!UUID_RE.test(attemptId)) {
    return NextResponse.json({ error: 'Mangler forsøk.' }, { status: 400 })
  }
  const orgSlug = searchParams.get('org')?.trim() || null

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })

  // ── Arkivquizen + kildekoblingen ──────────────────────────────────────────
  const { data: quiz, error: quizError } = await supabaseAdmin
    .from('quizzes')
    .select('id, quiz_type, source_quiz_id')
    .eq('id', archiveQuizId)
    .maybeSingle()

  if (quizError) {
    console.error('[arkiv plassering] quiz-oppslag feilet:', quizError.message)
    return NextResponse.json(
      { error: 'Kunne ikke hente plasseringen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }
  // Ruten gjelder KUN arkivkopier. Fredagsquizens egen plassering har sine
  // egne flater (/standings, /leaderboard/[id]) med sin egen gating; å la
  // dette endepunktet svare for dem ville vært den tredje veien inn.
  if (!quiz || quiz.quiz_type !== 'archive') {
    return NextResponse.json({ error: 'Finnes ikke.' }, { status: 404 })
  }

  // ── Premium-gaten, delt med spill-porten ─────────────────────────────────
  const premium = await getUserPremium(user.id)
  const gate = decideArchivePlayGate(quiz.quiz_type, premium)
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.error }, { status: gate.status })
  }

  // ── Spillerens eget arkivforsøk. Eierskapet er gaten ─────────────────────
  // Både quiz- og bruker-leddet står i spørringen: et forsøk som tilhører
  // noen andre, eller ligger på en annen quiz, skal ikke kunne gi et svar i
  // det hele tatt — heller ikke et som avslører at forsøket finnes.
  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from('attempts')
    .select('id, correct_answers, total_time_ms, submitted_at, is_team')
    .eq('id', attemptId)
    .eq('quiz_id', archiveQuizId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (attemptError) {
    console.error('[arkiv plassering] forsøksoppslag feilet:', attemptError.message)
    return NextResponse.json(
      { error: 'Kunne ikke hente plasseringen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }
  if (!attempt) return NextResponse.json({ error: 'Finnes ikke.' }, { status: 404 })
  // Et uferdig forsøk har ingen sluttscore å måle. Egen status, ikke en
  // «ingen plassering»-tilstand: her FINNES det et felt, spilleren er bare
  // ikke ferdig ennå.
  if (attempt.submitted_at === null) {
    return NextResponse.json({ error: 'Forsøket er ikke levert.' }, { status: 409 })
  }

  const sourceQuizId = (quiz.source_quiz_id as string | null) ?? null

  // ── Ingen kilde → ingen frosset felt. Svar uten å røre databasen mer ─────
  // Normaltilstanden for genererte quizer. Kort ut her sparer både
  // felt-oppslaget og org-gaten; beslutningen ligger uansett i
  // decideArchivePlacement, som har samme første linje.
  if (sourceQuizId === null) {
    return NextResponse.json({ placement: null, reason: 'ingen-kilde' })
  }

  // ── Org-scope: samme delte gate som /api/leaderboard/[id] ────────────────
  let orgMemberIds: string[] | null = null
  if (orgSlug) {
    const orgGate = await resolveOrgMembership(orgSlug, token)
    if (!orgGate.ok) {
      return NextResponse.json({ error: orgGate.error }, { status: orgGate.status })
    }
    orgMemberIds = orgGate.memberIds
  }

  // ── Det frosne feltet: alle leverte solo-forsøk på ORIGINALQUIZEN ────────
  // PAGINERT fra første linje. Taket er 1000 rader per side (PostgREST
  // db-max-rows, stille kutt) og spørringen gir én rad per forsøk — mest
  // spilte quiz i dag ligger på 71 (625 attempts totalt, over alle quizer),
  // så taket er langt unna, men et avkuttet felt ville gitt feil NEVNER i
  // nøyaktig det tallet hele funksjonen handler om. `.order('id')` er
  // totalordning (primærnøkkel, unik) og gjør pagineringsvinduene stabile.
  // Feltet er frosset, så samtidig skriving er ikke et tema her — men
  // ordningen koster ingenting og fjerner spørsmålet.
  let field: ArchiveFieldRow[]
  try {
    field = await fetchAllRows<ArchiveFieldRow>((from, to) =>
      supabaseAdmin
        .from('attempts')
        .select(FIELD_SELECT)
        .eq('quiz_id', sourceQuizId)
        .eq('is_team', false)
        .not('submitted_at', 'is', null)
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (e) {
    // «Vet ikke» er ikke «ingen plassering finnes»: et halvt eller manglende
    // felt ville gitt et tall som ser like presist ut som et riktig et.
    console.error(
      '[arkiv plassering] kunne ikke lese det frosne feltet:',
      e instanceof Error ? e.message : e
    )
    return NextResponse.json(
      { error: 'Kunne ikke hente plasseringen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }

  // ── Blokkerte brukere — KUN på det globale feltet ────────────────────────
  // Samme skille som leaderboard-ruten: i org-modus er visningen intern og
  // medlemskapet verifisert. Globalt må nevneren her stemme med det samme
  // quiz-leaderboardets synlige felt, ellers sier de to flatene ulike ting om
  // samme fredag. `season_points_awarded` avgjør hvilken fasit settet bygges
  // fra (historisk vs. live) — se lib/globally-blocked-set.ts.
  let blockedUserIds: ReadonlySet<string> = new Set<string>()
  if (!orgMemberIds) {
    const { data: sourceQuiz } = await supabaseAdmin
      .from('quizzes')
      .select('season_points_awarded')
      .eq('id', sourceQuizId)
      .maybeSingle()
    const attemptUserIds = [
      ...new Set(field.map((r) => r.user_id).filter((id): id is string => !!id)),
    ]
    blockedUserIds = await getGloballyBlockedSet(
      sourceQuizId,
      attemptUserIds,
      (sourceQuiz as { season_points_awarded?: boolean } | null)?.season_points_awarded === true
    )
  }

  // ── Beslutningen: alle tre fellene bor i den rene funksjonen ─────────────
  const outcome = decideArchivePlacement({
    sourceQuizId,
    field,
    self: {
      userId: user.id,
      correctAnswers: attempt.correct_answers ?? 0,
      totalTimeMs: attempt.total_time_ms ?? 0,
      isTeam: attempt.is_team === true,
    },
    orgMemberIds,
    blockedUserIds,
  })

  if (outcome.kind === 'ingen') {
    return NextResponse.json({ placement: null, reason: outcome.reason })
  }

  return NextResponse.json({
    placement: {
      rank: outcome.rank,
      total: outcome.total,
      fieldSize: outcome.fieldSize,
      selfWasInField: outcome.selfWasInField,
      scope: outcome.scope,
    },
    sourceQuizId,
  })
}
