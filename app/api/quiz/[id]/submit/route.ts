import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { calculateStreak } from '@/lib/ranking'
import { rateLimit } from '@/lib/rate-limit'
import { rateLimitShared } from '@/lib/rate-limit-shared'
import { PLAY_PRE_AUTH_BURST, PLAY_RATE_LIMIT, playRateLimitKey } from '@/lib/play-rate-limit'
import { logRateLimitHit } from '@/lib/rate-limit-log'
import { verifyAttemptToken } from '@/lib/attempt-token'
import { applyAnswerTimeIntegrity } from '@/lib/answer-time-integrity'
import { ALREADY_SUBMITTED_ERROR } from '@/lib/submit-response'
import { isTransientAuthStatus } from '@/lib/auth-transient'

// ── Service-role scoring for ukens quiz ──────────────────────────────────────
// Klienten sender KUN rå svar (selectedAnswer + timeMs per spørsmål). Serveren
// slår opp fasiten og beregner correct_answers, correct_streak og total_time_ms
// selv — klienten kan ikke lenger sette vilkårlige score-verdier. Erstatter den
// gamle klient-UPDATE-en på attempts (app/quiz/[id]/page.tsx finishQuiz).

// selectedAnswer er null når spilleren lot tiden løpe ut på spørsmålet
// (klienten sender { selectedAnswer: null, timeMs: <full tidsgrense> }).
// Et timeout-svar er et FEIL svar som skal lagres, ikke et fravær av svar.
type IncomingAnswer = { questionId: string; selectedAnswer: string | null; timeMs: number }

type QuestionRow = {
  id: string
  correct_answer: string | null
  correct_answers: string[] | null
  time_limit_seconds: number | null
}

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quizId } = await params
  if (!quizId) return NextResponse.json({ error: 'Mangler quiz-id' }, { status: 400 })

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'

  // ── Lag 1: grov burst-brems per IP, FØR token-oppslaget ─────────────────────
  // In-memory med vilje — se lib/play-rate-limit.ts for hvorfor.
  const preKey = `submit:pre:${ip}`
  if (!rateLimit(preKey, PLAY_PRE_AUTH_BURST.limit, PLAY_PRE_AUTH_BURST.windowMs).success) {
    logRateLimitHit(preKey, { lag: 'burst', ...PLAY_PRE_AUTH_BURST, quizId })
    return NextResponse.json({ error: 'For mange forsøk. Vent litt og prøv igjen.' }, { status: 429 })
  }

  // ── Identitet FØR lag 2 ─────────────────────────────────────────────────────
  // Samme ene `auth.getUser` som tidligere lå nede ved eierskapssjekken, bare
  // flyttet opp: lag 2 nøkler på bruker-id. Eierskapssjekken lenger nede bruker
  // resultatet herfra — den slår ikke opp på nytt.
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  let tokenUserId: string | null = null
  if (token) {
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
    // En TRANSIENT GoTrue-feil (nettverk, 5xx, 429) er ikke et ugyldig token.
    // Uten dette skillet ble spilleren stille behandlet som anonym: rate-
    // limiten falt ned i anon-bøtta (delt per IP — 29 kolleger bak ett
    // kontornett spiser hverandres kvote) og eierskapssjekken under svarte
    // 403 om et forsøk spilleren eier. 503 er ærlig: prøv igjen om litt,
    // ingenting er tapt. Et faktisk ugyldig token (401/403 fra GoTrue) går
    // som før til anon-behandling og 403 — se lib/auth-transient.ts.
    if (authError && isTransientAuthStatus(authError.status)) {
      console.error('[submit] auth-oppslag feilet transient:', { quizId, status: authError.status, message: authError.message })
      try {
        Sentry.captureMessage('submit: auth-oppslag feilet transient — avvist med 503, ingenting lagret', {
          level: 'error',
          tags: { area: 'quiz-submit' },
          extra: { quizId, authStatus: authError.status ?? null, errorMessage: authError.message },
        })
      } catch { /* varselet skal aldri kunne påvirke responsen */ }
      return NextResponse.json({ error: 'Kunne ikke bekrefte innloggingen. Prøv igjen om et øyeblikk.' }, { status: 503 })
    }
    tokenUserId = authData.user?.id ?? null
  }

  // ── Lag 2: den ekte grensen — per BRUKER når vi har en, ellers per IP ───────
  const rlKey = playRateLimitKey('submit', tokenUserId, ip)
  if (!(await rateLimitShared(rlKey, PLAY_RATE_LIMIT.limit, PLAY_RATE_LIMIT.windowMs)).success) {
    logRateLimitHit(rlKey, { lag: 'delt', ...PLAY_RATE_LIMIT, innlogget: tokenUserId !== null, quizId })
    return NextResponse.json({ error: 'For mange forsøk. Vent litt og prøv igjen.' }, { status: 429 })
  }

  let body: { attemptId?: unknown; deviceId?: unknown; answers?: unknown }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Ugyldig body' }, { status: 400 })
  }

  const attemptId = typeof body.attemptId === 'string' ? body.attemptId : null
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : null
  if (!attemptId) return NextResponse.json({ error: 'Mangler attemptId' }, { status: 400 })

  // Samme signerte token som questions krever — knytter innsendingen til det
  // forsøket som faktisk ble startet gjennom start-attempt.
  const attemptToken = request.headers.get('x-attempt-token') ?? ''
  if (!attemptToken || !verifyAttemptToken(attemptToken, attemptId, quizId)) {
    return NextResponse.json({ error: 'Ugyldig eller manglende attempt-token' }, { status: 403 })
  }

  if (!Array.isArray(body.answers)) {
    return NextResponse.json({ error: 'Mangler svar' }, { status: 400 })
  }

  // MERK: selectedAnswer må godta BÅDE string og null. Fram til 25. juli 2026 sto
  // det `typeof selectedAnswer === 'string'` her, og siden `typeof null === 'object'`
  // ble hvert eneste timeout-svar stille forkastet før innsetting i attempt_answers.
  // Spørsmålet forsvant da helt fra dataene i stedet for å telle som feil, noe som
  // lot correct_streak fortsette ubrutt over det manglende spørsmålet.
  const answers: IncomingAnswer[] = (body.answers as unknown[])
    .filter((a): a is IncomingAnswer =>
      !!a && typeof a === 'object' &&
      typeof (a as IncomingAnswer).questionId === 'string' &&
      (typeof (a as IncomingAnswer).selectedAnswer === 'string' ||
        (a as IncomingAnswer).selectedAnswer === null) &&
      typeof (a as IncomingAnswer).timeMs === 'number',
    )

  // ── 1. Hent attempt-raden og verifiser eierskap ────────────────────────────
  const { data: attempt, error: attErr } = await supabaseAdmin
    .from('attempts')
    .select('id, quiz_id, user_id, correct_answers, submitted_at, completed_at')
    .eq('id', attemptId)
    .maybeSingle()

  // Splittet med vilje: en transient DB-feil er ikke «forsøket finnes ikke».
  // 404 lot en lesefeil se ut som feil diagnose; 503 sier prøv igjen.
  if (attErr) {
    console.error('[submit] attempt-oppslag feilet:', { attemptId, quizId, errorMessage: attErr.message })
    return NextResponse.json({ error: 'Kunne ikke hente forsøket. Prøv igjen om et øyeblikk.' }, { status: 503 })
  }
  if (!attempt) {
    return NextResponse.json({ error: 'Forsøk ikke funnet' }, { status: 404 })
  }
  if (attempt.quiz_id !== quizId) {
    return NextResponse.json({ error: 'Forsøk hører ikke til denne quizen' }, { status: 403 })
  }

  // Eierskap: innlogget → token-bruker må eie raden; gjest → raden må være gjest
  // `tokenUserId` er slått opp øverst (for rate-limit-nøkkelen) og gjenbrukes
  // her — nøyaktig samme semantikk som før: token til stede men ugyldig gir
  // `null` og dermed 403, ikke gjeste-behandling.
  if (token) {
    if (!tokenUserId || attempt.user_id !== tokenUserId) {
      return NextResponse.json({ error: 'Ingen tilgang til dette forsøket' }, { status: 403 })
    }
  } else if (attempt.user_id !== null) {
    // Ingen token, men raden tilhører en innlogget bruker → avvis.
    return NextResponse.json({ error: 'Mangler autentisering' }, { status: 403 })
  }

  // Dobbel-scoring-vern: allerede scoret?
  // Teksten er en DELT KONTRAKT — klienten tolker den spesifikt som «forsøket
  // ligger lagret» når spilleren har trykket «Prøv igjen» etter en timeout.
  // Se lib/submit-response.ts. Ikke skriv den ordrett her.
  if (attempt.submitted_at !== null || (attempt.correct_answers ?? 0) > 0) {
    return NextResponse.json({ error: ALREADY_SUBMITTED_ERROR }, { status: 403 })
  }

  // ── 1b. Tidsvalidering mot server-klokken ───────────────────────────────────
  // Alt tidsforbruk klienten selv rapporterer er manipulerbart. Her måler vi mot
  // attempts.completed_at, som settes til now() av DB-defaulten når raden
  // opprettes i start-attempt og aldri overskrives etterpå — altså forsøkets
  // starttidspunkt, skrevet av serveren. (Tabellen har ingen created_at-kolonne;
  // completed_at er den faktiske server-tidsstemplingen ved opprettelse.)
  // En hel quiz levert på under to sekunder er ikke en rask spiller — det er et
  // script.
  //
  // Todelt med vilje: harde avvisninger kun der ingen ekte spiller kan havne;
  // det mer sannsynlige gråsone-tilfellet (under ett sekund per spørsmål i snitt)
  // logges i stedet, så vi ser omfanget uten å risikere falske positiver på en
  // fredagsquiz i live drift.
  const elapsedMs = Date.now() - new Date(attempt.completed_at).getTime()
  if (elapsedMs < 2000) {
    console.warn('[submit] avvist på tid:', { attemptId, quizId, elapsedMs })
    return NextResponse.json({ error: 'Innsendingen kom for raskt' }, { status: 403 })
  }
  if (answers.length > 0 && elapsedMs < answers.length * 1000) {
    console.warn('[submit] mistenkelig rask innsending:', {
      attemptId, quizId, elapsedMs, questions: answers.length,
    })
  }

  // ── 2. Hent quiz + spørsmål (fasit) ─────────────────────────────────────────
  const [quizRes, questionsRes] = await Promise.all([
    supabaseAdmin.from('quizzes').select('time_limit_seconds').eq('id', quizId).maybeSingle(),
    supabaseAdmin
      .from('questions')
      .select('id, correct_answer, correct_answers, time_limit_seconds')
      .eq('quiz_id', quizId),
  ])
  const { data: quiz, error: quizErr } = quizRes
  const { data: questionRows, error: questionsErr } = questionsRes

  // Disse to lesingene er alt scoringen hviler på, og feilen deres fantes
  // tidligere ikke som konsept i ruten: en feilet questions-spørring ga tom
  // qMap → hvert svar «ukjent» → 0 riktige STEMPLET med submitted_at, og
  // dobbel-scoring-vernet gjorde nullen permanent. En feilet quiz-spørring
  // ga fallback 30 s tidsgrense — som ingen quiz i prod faktisk har (målt
  // 18. august: 15 s × 12, 10 s × 1), så taket på svartidene ble feil og
  // total_time_ms (tiebreakeren) skrevet galt, like permanent. 503 FØR noen
  // skriving: raden er ustemplet, klienten kan prøve på nytt, ingenting tapt.
  if (quizErr || questionsErr) {
    console.error('[submit] quiz-/fasit-oppslag feilet:', {
      attemptId, quizId,
      quizError: quizErr?.message ?? null,
      questionsError: questionsErr?.message ?? null,
    })
    try {
      Sentry.captureMessage('submit: quiz-/fasit-oppslag feilet — avvist med 503, ingenting lagret', {
        level: 'error',
        tags: { area: 'quiz-submit' },
        extra: {
          attemptId, quizId,
          quizError: quizErr?.message ?? null,
          questionsError: questionsErr?.message ?? null,
        },
      })
    } catch { /* varselet skal aldri kunne påvirke responsen */ }
    return NextResponse.json({ error: 'Kunne ikke hente quizdata. Prøv igjen om et øyeblikk.' }, { status: 503 })
  }

  const quizTimeLimit = quiz?.time_limit_seconds ?? 30
  const qMap = new Map<string, QuestionRow>(
    ((questionRows ?? []) as QuestionRow[]).map(q => [q.id, q]),
  )

  // ── 3+4. Beregn is_correct, score, streak og korrigert tid — server-side ────
  type Scored = { questionId: string; selectedAnswer: string | null; isCorrect: boolean; timeMs: number }
  const scored: Scored[] = []
  const reported: { timeMs: number; limitMs: number }[] = []
  for (const a of answers) {
    const q = qMap.get(a.questionId)
    if (!q) continue // ukjent spørsmål — telles ikke

    // Timeout (selectedAnswer === null) er ALLTID feil, og må sjekkes eksplisitt
    // først: uten denne vakten ville `a.selectedAnswer === q.correct_answer` bli
    // true for et spørsmål der correct_answer også er null (null === null), og et
    // ubesvart spørsmål ville blitt scoret som riktig.
    const isCorrect = a.selectedAnswer === null
      ? false
      : q.correct_answers && q.correct_answers.length > 0
        ? q.correct_answers.includes(a.selectedAnswer)
        : a.selectedAnswer === q.correct_answer

    reported.push({ timeMs: a.timeMs, limitMs: (q.time_limit_seconds ?? quizTimeLimit) * 1000 })
    scored.push({ questionId: a.questionId, selectedAnswer: a.selectedAnswer, isCorrect, timeMs: 0 })
  }

  // ── INVARIANT-VAKT: svar inn, men INGENTING kunne scores → aldri stemple ──
  // Vakten over feller årsaken vi FANT (lesefeil); denne feller symptomet,
  // uansett framtidig årsak: enhver vei til tom/feil qMap (spørsmål slettet
  // midt i spilling, endret kolonneform, en ny kodesti) ender her i stedet
  // for som en permanent 0-er. En ærlig klient har id-ene sine fra
  // questions-ruten for nettopp denne quizen, så minst ett svar treffer
  // alltid når fasiten finnes — scored helt tom med svar til stede er per
  // konstruksjon en systemfeil, aldri en spiller. Står FØR skrivingen:
  // dobbel-scoring-vernet og den atomiske submitted_at-vakten er urørt.
  if (answers.length > 0 && scored.length === 0) {
    console.error('[submit] ingen svar traff fasiten:', {
      attemptId, quizId, answers: answers.length, fasitRader: (questionRows ?? []).length,
    })
    try {
      Sentry.captureMessage('submit: ingen svar traff fasiten — avvist med 503, ingenting lagret', {
        level: 'error',
        tags: { area: 'quiz-submit' },
        extra: { attemptId, quizId, answers: answers.length, fasitRader: (questionRows ?? []).length },
      })
    } catch { /* varselet skal aldri kunne påvirke responsen */ }
    return NextResponse.json({ error: 'Kunne ikke score svarene. Prøv igjen om et øyeblikk.' }, { status: 503 })
  }

  // Tak (tidsgrensen) OG gulv på hver enkelt tid, pluss gulv på SUMMEN med
  // veggklokke-substitusjon som utfall (aldri 403 — en feilklassifisering skal
  // koste en dårligere tid, ikke et tapt forsøk). Se lib/answer-time-integrity.ts
  // for kalibreringen og for hvorfor forløpt veggklokketid ikke kan brukes som
  // gulv på summen.
  const timeCheck = applyAnswerTimeIntegrity(reported, elapsedMs)
  for (let i = 0; i < scored.length; i++) scored[i].timeMs = timeCheck.times[i]

  // Logging i to bånd, begge med søkbar ropemarkør for Vercel-loggen:
  // - "SVARTID ERSTATTET": under gulvet — totalen ble substituert.
  // - "MISTENKELIG svartid": over gulvet, men verdt å se på (observasjonsbåndet
  //   suspicious_low_avg, per-svar-gulvet floor_clamped, sum_over_elapsed).
  // Formålet er datainnsamling: juks er hittil hypotetisk, og båndene viser om
  // det finnes en reell hale FØR vi eventuelt strammer inn.
  if (timeCheck.suspicious) {
    const fields = {
      attemptId, quizId, elapsedMs,
      questions: scored.length,
      rapportertSumMs: timeCheck.rawTotalMs,
      lagretSumMs: timeCheck.totalMs,
      korrigerteSvar: timeCheck.clampedCount,
      grunner: timeCheck.reasons,
    }
    if (timeCheck.substituted) {
      console.warn('[submit] SVARTID ERSTATTET — rapportert sum under gulvet:', fields)
    } else {
      console.warn('[submit] MISTENKELIG svartid:', fields)
    }
  }

  const correctAnswers = scored.filter(s => s.isCorrect).length
  const correctStreak = calculateStreak(scored.map(s => ({ is_correct: s.isCorrect })))
  const totalTimeMs = timeCheck.totalMs

  // ── 5. Skriv: attempts-UPDATE, attempt_answers-INSERT, played_log ───────────
  // .select() gjør at PostgREST returnerer de faktisk oppdaterte radene, slik at
  // vi kan se om `.is('submitted_at', null)`-vakten slo til. Uten den kunne vi
  // ikke skille "oppdaterte raden" fra "traff ingen rad" — begge gir error: null.
  const { data: updatedRows, error: updErr } = await supabaseAdmin
    .from('attempts')
    .update({
      correct_answers: correctAnswers,
      total_time_ms: totalTimeMs,
      correct_streak: correctStreak,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', attemptId)
    .is('submitted_at', null) // siste forsvar mot race: kun hvis ikke alt levert
    .select('id')

  if (updErr) {
    return NextResponse.json({ error: 'Kunne ikke lagre resultatet' }, { status: 500 })
  }

  // NULL RADER OPPDATERT = en annen samtidig forespørsel rakk å levere først.
  // Sjekken øverst i handleren (submitted_at !== null) er en les-så-skriv og
  // dermed ikke atomisk: to forespørsler kan begge lese submitted_at = null og
  // begge slippe forbi. UPDATE-en er atomisk og bare ÉN av dem vinner, men før
  // denne vakten fortsatte begge ned til INSERT-en under — og da fikk forsøket
  // to sett attempt_answers-rader. Vi må returnere her, ikke bare hoppe over
  // INSERT-en, så vi heller ikke skriver played_log en ekstra gang.
  //
  // Vinneren har allerede lagret nøyaktig samme score (samme svar, samme fasit),
  // så vi leser den ferdige raden og returnerer den i stedet for en feil —
  // spilleren skal se resultatet sitt, ikke en feilmelding, for en race
  // hen ikke kan gjøre noe med.
  if (!updatedRows || updatedRows.length === 0) {
    console.warn('[submit] samtidig innsending — INSERT hoppet over:', { attemptId, quizId })
    const { data: winner } = await supabaseAdmin
      .from('attempts')
      .select('correct_answers, total_time_ms, correct_streak')
      .eq('id', attemptId)
      .maybeSingle()

    if (!winner) {
      return NextResponse.json({ error: ALREADY_SUBMITTED_ERROR }, { status: 409 })
    }
    return NextResponse.json({
      correctAnswers: winner.correct_answers ?? 0,
      totalTimeMs: winner.total_time_ms ?? 0,
      correctStreak: winner.correct_streak ?? 0,
      answersWarning: false,
      alreadySubmitted: true,
    })
  }

  let answersWarning = false
  if (scored.length > 0) {
    const { error: ansErr } = await supabaseAdmin.from('attempt_answers').insert(
      scored.map(s => ({
        attempt_id: attemptId,
        question_id: s.questionId,
        selected_answer: s.selectedAnswer,
        is_correct: s.isCorrect,
        time_ms: s.timeMs,
      })),
    )
    if (ansErr) {
      console.error('[submit] attempt_answers insert feilet:', ansErr.message)
      // Scoren på attempts-raden er allerede lagret (UPDATE-en over), så ruten
      // fortsetter bevisst med 200 — men per-spørsmål-detaljene mangler da for
      // dette forsøket, og historikk/svarfordeling blir tomme for det. Klienten
      // leser ikke answersWarning (beslutning 16. august 2026: ikke vis noe til
      // spilleren — det er ingenting hen kan gjøre), så uten dette varselet var
      // console.error over eneste spor. Samme «stille feil med 200»-klasse som
      // lib/money-path-alert.ts, men uten penger involvert — derfor et direkte
      // kall her i stedet for den sinken. Fast meldingstekst så Sentry teller
      // forekomster på ÉN sak; id-ene ligger i extra. Kaster aldri: innsendingen
      // er allerede vellykket og skal ikke kunne velte på et varsel.
      try {
        Sentry.captureMessage('submit: attempt_answers-insert feilet — score lagret, detaljer mangler', {
          level: 'error',
          tags: { area: 'quiz-submit' },
          extra: { attemptId, quizId, errorMessage: ansErr.message, errorCode: ansErr.code },
        })
      } catch { /* varselet skal aldri kunne påvirke innsendingen */ }
      answersWarning = true
    }
  }

  if (deviceId) {
    const { error: logErr } = await supabaseAdmin
      .from('played_log')
      .insert({ quiz_id: quizId, identifier: deviceId })
    // KJENT SVAKHET: hvis denne feiler kan brukeren spille quizen på nytt
    // (played_log brukes som deviceId-sjekk i quiz-siden). Score er lagret.
    if (logErr) console.error('[submit] played_log insert feilet:', logErr.message)
  }

  // profiles.last_seen_at — kartlegging 25. juli viste at denne kolonnen i
  // praksis ALDRI ble oppdatert etter selve innloggingen: Supabase fornyer
  // sesjonen stille i bakgrunnen (refresh-token) uten å treffe /auth/callback
  // eller /api/auth/bekreft på nytt, så "Sist aktiv" viste stille brukerens
  // FØRSTE innloggingstidspunkt uansett hvor mange quizer hen spilte senere
  // (121 av 127 spillere hadde et nyere quiz-forsøk enn last_seen_at). Samme
  // kolonne leses av "Aktive 30 dager" på /admin og re-engagement-cronen —
  // begge blir riktigere av at den nå oppdateres oftere, uten at noe av dem
  // er endret her.
  //
  // Kun innloggede (gjester har ingen profiles-rad). Fail-soft som
  // played_log over: en feilet oppdatering skal ALDRI kunne forsinke eller
  // blokkere scoringen — den er allerede lagret uansett utfall her.
  if (attempt.user_id) {
    const { error: seenErr } = await supabaseAdmin
      .from('profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', attempt.user_id)
    if (seenErr) console.error('[submit] last_seen_at update feilet:', seenErr.message)
  }

  // ── 6. Returner server-beregnet score til resultatskjermen ──────────────────
  return NextResponse.json({ correctAnswers, totalTimeMs, correctStreak, answersWarning })
}
