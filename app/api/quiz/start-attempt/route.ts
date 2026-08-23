import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/rate-limit'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { createAttemptToken } from '@/lib/attempt-token'
import { decidePremiumFromProfile, PREMIUM_PROFILE_COLUMNS, type PremiumProfileRow } from '@/lib/premium-check'
import { isTransientAuthStatus } from '@/lib/auth-transient'
import { PLAY_PRE_AUTH_BURST, PLAY_RATE_LIMIT, playRateLimitKey } from '@/lib/play-rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { SUBMIT_GRACE_MS, QUIZ_CLOSED_ERROR, isWithinGrace, attemptStartedBeforeClose } from '@/lib/late-play-window'

// ── Service-role attempt-opprettelse ─────────────────────────────────────────
// Erstatter den gamle klient-INSERT-en i app/quiz/[id]/page.tsx (startQuiz).
// Etter at RLS låser INSERT/UPDATE/DELETE på attempts til service_role, er dette
// den eneste lovlige veien til å opprette en attempt-rad. Klienten kan ikke
// lenger sette vilkårlige score-verdier direkte i databasen.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'

  // ── Lag 1: grov burst-brems per IP, FØR token-oppslaget ─────────────────────
  // In-memory med vilje — se lib/play-rate-limit.ts for hvorfor.
  const preKey = `start-attempt:pre:${ip}`
  if (!rateLimit(preKey, PLAY_PRE_AUTH_BURST.limit, PLAY_PRE_AUTH_BURST.windowMs).success) {
    logRateLimitHit(preKey, { lag: 'burst', ...PLAY_PRE_AUTH_BURST })
    return NextResponse.json({ error: 'For mange forsøk. Vent litt og prøv igjen.' }, { status: 429 })
  }

  // ── Sesjon (valgfri — ruten tillater fortsatt anonyme kall) ─────────────────
  // Flyttet HIT fra midt i handleren: lag 2 nøkler på bruker-id, så identiteten
  // må være avgjort før grensen sjekkes. Ingen ekstra rundtur — dette er samme
  // ene `auth.getUser` som sto lenger nede, bare tidligere i rekkefølgen.
  let userId: string | null = null
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (token) {
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
    // Samme vakt som i submit: en TRANSIENT GoTrue-feil (nettverk, 5xx, 429)
    // er ikke et ugyldig token. Uten skillet ble en innlogget spiller stille
    // behandlet som gjest — anon-rate-limit-bøtte (delt per IP), og verre:
    // attempt-raden ville blitt opprettet med user_id = NULL, utenfor både
    // replay-sperren og unik-indeksen. Ugyldig token (401/403) går som før
    // til gjeste-behandling. Se lib/auth-transient.ts.
    if (authError && isTransientAuthStatus(authError.status)) {
      console.error('[start-attempt] auth-oppslag feilet transient:', { status: authError.status, message: authError.message })
      try {
        Sentry.captureMessage('start-attempt: auth-oppslag feilet transient — avvist med 503', {
          level: 'error',
          tags: { area: 'quiz-start-attempt' },
          extra: { authStatus: authError.status ?? null, errorMessage: authError.message },
        })
      } catch { /* varselet skal aldri kunne påvirke responsen */ }
      return NextResponse.json({ error: 'Kunne ikke bekrefte innloggingen. Prøv igjen om et øyeblikk.' }, { status: 503 })
    }
    userId = authData.user?.id ?? null
  }

  // ── Innlogging er PÅKREVD (24. august 2026) ─────────────────────────────────
  // Beslutningen om at man kun skal kunne spille innlogget er gammel; klienten
  // har hard-redirectet uinnloggede til /login siden `bced92d` (16. mai 2026).
  // Serveren gjorde det aldri — token var valgfritt, og et kall uten (eller med
  // et UGYLDIG) token opprettet en rad med `user_id: null`. Målt mot prod
  // 24. august 2026: 625 forsøk, 0 med `user_id` NULL. Veien har aldri vært
  // brukt av en ekte spiller, men den sto åpen for et script.
  //
  // Hvorfor den måtte lukkes: en gjeste-rad står utenfor BÅDE replay-sperren
  // (som slår opp på `user_id`) og unik-indeksen `attempts_user_quiz_unique`.
  // De to vernene som gjelder alle andre spillere, gjaldt ikke den ene raden
  // ingen eier.
  //
  // Vakten står FØR lag 2 med vilje: en forespørsel vi alltid avviser skal ikke
  // koste en Upstash-rundtur. Lag 1 (in-memory, 120/min per IP) står allerede
  // foran og demper en flom; selve avvisningen gjør null DB-arbeid.
  // Plasseringen har også en produkt-side: en spiller hvis sesjon nettopp døde
  // får et ærlig 401 («logg inn») i stedet for å bli dyttet ned i anon-bøtta og
  // møte 429 sammen med 28 kolleger bak samme kontor-IP.
  //
  // 401 + `needsLogin` er en DELT KONTRAKT med klienten: `startQuiz` i
  // app/quiz/[id]/page.tsx åpner innloggingspanelet på 401 i stedet for å vise
  // en generisk feiltekst. Endres statuskoden her, må kallstedet følge etter.
  if (!userId) {
    return NextResponse.json(
      { error: 'Du må være innlogget for å spille.', needsLogin: true },
      { status: 401 },
    )
  }

  // ── Lag 2: den ekte grensen — per BRUKER ────────────────────────────────────
  // `userId` er garantert non-null her (vakten over). Anon-grenen i
  // `playRateLimitKey` er derfor uoppnåelig FOR DENNE RUTEN — den lever videre
  // for `submit`, som fortsatt rate-limiter før eierskapssjekken.
  //
  // MERK: `if (userId)`-blokkene lenger nede (suspensjonssperre, replay-sperre,
  // gjenbruk av uferdig forsøk) er nå alltid sanne. De er BEVISST latt stå
  // urørt: å reindentere ~40 linjer i spillestien ville skjult reelle endringer
  // i diff-gjennomgangen. De er vestigiale, ikke betingede.
  const rlKey = playRateLimitKey('start-attempt', userId, ip)
  if (!(await rateLimitShared(rlKey, PLAY_RATE_LIMIT.limit, PLAY_RATE_LIMIT.windowMs)).success) {
    logRateLimitHit(rlKey, { lag: 'delt', ...PLAY_RATE_LIMIT, innlogget: userId !== null })
    return NextResponse.json({ error: 'For mange forsøk. Vent litt og prøv igjen.' }, { status: 429 })
  }

  let body: {
    quizId?: unknown
    playerName?: unknown
    isTeam?: unknown
    teamSize?: unknown
    leaderDisplayName?: unknown
  }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  // ── Validering ──────────────────────────────────────────────────────────────
  const quizId = typeof body.quizId === 'string' ? body.quizId : ''
  if (!UUID_RE.test(quizId)) {
    return NextResponse.json({ error: 'Ugyldig quiz-id' }, { status: 400 })
  }

  const playerName = typeof body.playerName === 'string' ? body.playerName.trim() : ''
  if (!playerName || playerName.length > 100) {
    return NextResponse.json({ error: 'Ugyldig navn' }, { status: 400 })
  }

  const isTeam = body.isTeam === true
  const teamSize = isTeam
    ? (typeof body.teamSize === 'number' && body.teamSize > 0 ? Math.floor(body.teamSize) : 1)
    : 1
  const leaderDisplayName = typeof body.leaderDisplayName === 'string' && body.leaderDisplayName.trim()
    ? body.leaderDisplayName.trim()
    : null

  // ── Suspensjonssperre ─────────────────────────────────────────────────────────
  // Tidligere håndhevet av RLS INSERT-policyen. service_role omgår RLS, så vi må
  // sjekke eksplisitt her etter at INSERT er låst til service_role.
  // Premium leses i SAMME spørring (P-2, 23. august 2026) — ikke i en ny.
  // Attempt-tokenet bærer premium som et signert krav, slik at live-rutene kan
  // gate eksakt plassering uten et auth-oppslag per kall (se
  // lib/attempt-token.ts for regnestykket: ~43 sparte rundturer per spiller per
  // quiz). Kolonnene kommer fra PREMIUM_PROFILE_COLUMNS, og avgjørelsen fra
  // decidePremiumFromProfile — samme grace-regler som getUserPremium, ikke en
  // ny kopi.
  let callerIsPremium = false
  if (userId) {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select(`suspended_until, ${PREMIUM_PROFILE_COLUMNS}`)
      .eq('id', userId)
      .maybeSingle<{ suspended_until: string | null } & PremiumProfileRow>()
    if (profile?.suspended_until && new Date(profile.suspended_until) > new Date()) {
      return NextResponse.json({ error: 'Kontoen er suspendert', suspended: true }, { status: 403 })
    }
    // «Vet ikke» blir her til «ikke premium» — et BEVISST valg, ikke en
    // forglemmelse, og det eneste stedet i kodebasen der den retningen er
    // riktig. Alternativet er å nekte quiz-start på en lesefeil, og det ville
    // gjort en visningsdetalj til en sperre foran hele produktet. Prisen er at
    // en Premium-spiller ser spennet i stedet for eksakt plass i den ene
    // quizen — de spiller videre, og en sidelast henter nytt token. Logges
    // fordi et stille tap av en betalt funksjon ellers ikke etterlater spor.
    if (profileError) {
      console.error('[start-attempt] kunne ikke lese premium for token-kravet:', profileError.message)
    }
    callerIsPremium = decidePremiumFromProfile(profile ?? null, new Date())
  }

  // ── Quizen må finnes og være åpen ─────────────────────────────────────────────
  const { data: quiz } = await supabaseAdmin
    .from('quizzes')
    .select('id, opens_at, closes_at')
    .eq('id', quizId)
    .maybeSingle()

  if (!quiz) {
    return NextResponse.json({ error: 'Quizen finnes ikke' }, { status: 404 })
  }

  const now = Date.now()
  const opensAt = quiz.opens_at ? new Date(quiz.opens_at).getTime() : null
  const closesAt = quiz.closes_at ? new Date(quiz.closes_at).getTime() : null
  // Etter stengetid finnes ÉN lovlig vei videre: GJENBRUK av et uferdig forsøk
  // startet før closes_at, innenfor SUBMIT_GRACE_MS (reload-stien i B-10 — en
  // spiller som mistet siden 21:59 skal kunne gjenoppta/levere 22:01). Vinduet
  // er submit-fristen, ikke spørsmålsfristen: i sonen mellom de to skal hun
  // få token til å LEVERE det localStorage har, selv om ingen nye spørsmål
  // serveres. Nye forsøk etter stengetid opprettes aldri — se vakten etter
  // gjenbruks-oppslaget.
  const afterClose = closesAt !== null && now > closesAt
  if (
    (opensAt !== null && now < opensAt) ||
    (afterClose && !isWithinGrace(closesAt, now, SUBMIT_GRACE_MS))
  ) {
    return NextResponse.json({ error: QUIZ_CLOSED_ERROR }, { status: 403 })
  }

  // ── Replay-sperre for innloggede ──────────────────────────────────────────────
  // Et levert forsøk (submitted_at satt) betyr at brukeren allerede har spilt.
  // Uferdige forsøk (avbrutt før innsending) blokkerer ikke — da kan man starte på nytt.
  if (userId) {
    const { data: existing } = await supabaseAdmin
      .from('attempts')
      .select('id')
      .eq('quiz_id', quizId)
      .eq('user_id', userId)
      .not('submitted_at', 'is', null)
      .limit(1)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'Du har allerede spilt denne quizen', alreadyPlayed: true }, { status: 409 })
    }

    // Gjenbruk eksisterende UFERDIG forsøk (submitted_at NULL) i stedet for å
    // opprette en ny rad. Dette hindrer duplikate attempts-rader når brukeren
    // laster siden på nytt / fortsetter etter en hang. limit(1) gjør maybeSingle
    // trygg selv om historiske duplikater finnes.
    const { data: unfinished } = await supabaseAdmin
      .from('attempts')
      .select('id, completed_at')
      .eq('quiz_id', quizId)
      .eq('user_id', userId)
      .is('submitted_at', null)
      .order('completed_at', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    // Etter stengetid gjenbrukes KUN forsøk startet før closes_at —
    // completed_at er radens server-skrevne starttidspunkt (DB-default now()).
    if (
      unfinished &&
      (!afterClose || (closesAt !== null && attemptStartedBeforeClose(unfinished.completed_at, closesAt)))
    ) {
      // Tokenet MÅ følge med også her — gjenopptakelse etter reload går denne
      // veien, og uten token kommer klienten ikke videre til questions/submit.
      return NextResponse.json({
        attemptId: unfinished.id,
        attemptToken: createAttemptToken(unfinished.id, quizId, { premium: callerIsPremium }),
        reused: true,
      })
    }
  }

  // ── Etter stengetid opprettes ALDRI nye forsøk ──────────────────────────────
  // Vinduet over slapp oss hit kun for å finne noe å gjenbruke. Fantes det
  // ikke (eller startet det etter stengetid), er svaret det samme som før
  // B-10: quizen er stengt. Uten denne vakten ville reload-stien åpnet en
  // helt ny spillevei etter closes_at.
  if (afterClose) {
    return NextResponse.json({ error: QUIZ_CLOSED_ERROR }, { status: 403 })
  }

  // ── Antall spørsmål (settes ved opprettelse, brukes i resultatvisning) ─────────
  const { count: questionCount } = await supabaseAdmin
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('quiz_id', quizId)

  if (questionCount === null) {
    return NextResponse.json({ error: 'Kunne ikke hente antall spørsmål.' }, { status: 500 })
  }

  // ── Opprett attempt ─────────────────────────────────────────────────────────
  // correct_streak settes bevisst IKKE her — NULL er markøren for "ikke ferdig
  // scoret" som historikk/ranking filtrerer på. submit/route.ts setter den ved
  // innsending. submitted_at settes til NULL av samme grunn.
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('attempts')
    .insert({
      quiz_id: quizId,
      player_name: playerName,
      is_team: isTeam,
      team_size: teamSize,
      total_questions: questionCount,
      correct_answers: 0,
      total_time_ms: 0,
      user_id: userId,
      leader_display_name: isTeam ? leaderDisplayName : null,
      submitted_at: null,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    // Unik constraint (attempts_user_quiz_unique) traff pga. samtidig forespørsel
    // — hent og gjenbruk den eksisterende uferdige raden i stedet for å feile.
    if (insertError?.code === '23505' && userId) {
      const { data: race } = await supabaseAdmin
        .from('attempts')
        .select('id')
        .eq('quiz_id', quizId)
        .eq('user_id', userId)
        .is('submitted_at', null)
        .order('completed_at', { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (race) {
        return NextResponse.json({
          attemptId: race.id,
          attemptToken: createAttemptToken(race.id, quizId, { premium: callerIsPremium }),
          reused: true,
        })
      }
    }
    console.error('[start-attempt] insert feilet:', insertError?.message)
    return NextResponse.json({ error: 'Kunne ikke starte forsøket' }, { status: 500 })
  }

  return NextResponse.json({
    attemptId: inserted.id,
    attemptToken: createAttemptToken(inserted.id, quizId, { premium: callerIsPremium }),
  })
}
