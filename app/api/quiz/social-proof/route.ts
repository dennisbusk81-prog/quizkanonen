import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { describeQuestionTimeLimit } from '@/lib/quiz-time-limit'
import { getGloballyBlockedSet } from '@/lib/globally-blocked-set'

// GLOBAL SYNLIGHETS-GATE (13. august 2026): brukere blokkert fra den åpne
// konkurransen (org med allow_global_league=false, eller eget opt-out —
// lib/globally-blocked-set.ts, samme delte sett som /api/leaderboard/[id],
// prev-rank og standings) vises IKKE som navnepiller og telles IKKE i
// totalPlayers. Svaret går til helt anonyme kallere og er CDN-cachet — uten
// gaten kunne ansatte i en org som har valgt «hold resultatene internt» dukke
// opp som navnepille for hvem som helst.
//
// Gjester (user_id null) kan ikke blokkeres og berøres aldri av gaten.
//
// BEVISST getGloballyBlockedSet direkte, IKKE lib/public-snapshot.ts: denne
// ruten teller PÅBEGYNTE forsøk i quiz-vinduet (ingen submitted_at-filter —
// en egen, kjent inkonsistens som ikke skal endres her), mens snapshoten bak
// public-snapshot-helperen kun inneholder LEVERTE. Å hente populasjonen fra
// helperen ville stille endret hva totalPlayers teller. Ingen rangering
// finnes her, så helperens re-rank-steg har uansett ingenting å gjøre.
//
// Fail-stengt følger med fra lib-en: klarer den ikke avgjøre hvem som er
// blokkert, returnerer den HELE den spurte lista — da vises kun gjester.
// Admin-flatene er upåvirket: de leser attempts direkte med supabaseAdmin
// (admin/dashboard, admin/quizzes/[id] m.fl.), aldri denne ruten.
//
// Cache-headeren (public, s-maxage=60) står uendret: svaret inneholder ikke
// lenger blokkerte data, så CDN-caching av det er like trygt som før. En
// fersk utmelding kan henge igjen i inntil ~90s (60s CDN + 30s blocked-
// cache) — akseptert.

// `timeLimitLabel` er den EFFEKTIVE tidsgrensen («15s», ev. «10–20s» ved sprik),
// utledet fra spørsmålene — ikke fra quiz-raden. Den ligger her, og ikke i en
// egen rute, fordi startskjermen allerede henter denne ruten og den allerede
// slår opp quiz-raden: null ekstra rundturer for klienten.
//
// FALLGRUVE: alle emptyResponse()-utgangene under er NORMALTILFELLER, ikke feil
// — «ingen har spilt ennå» er sannheten de første minuttene etter at en quiz
// åpner. Etiketten må derfor følge med UT AV DEM også, ellers mister
// startskjermen den nettopp når flest folk står på den. Derfor tar
// emptyResponse etiketten som argument i stedet for å hardkode null.
function emptyResponse(timeLimitLabel: string | null = null) {
  return NextResponse.json(
    { totalPlayers: 0, sampleNames: [], timeLimitLabel },
    { headers: { 'Cache-Control': 'public, s-maxage=60, max-age=0' } }
  )
}

// Spørsmålenes tidsgrenser. Egen funksjon fordi den skal feile MYKT: teksten på
// startskjermen faller da tilbake på quiz-nivået (samme tall som før 7. august
// 2026), i stedet for at hele social-proof-svaret ryker.
async function effectiveTimeLimitLabel(
  quizId: string,
  quizLimit: number | null,
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('questions')
      .select('time_limit_seconds')
      .eq('quiz_id', quizId)
    if (error) {
      console.error('[social-proof] questions time limit query error:', error)
      return describeQuestionTimeLimit([], quizLimit)
    }
    return describeQuestionTimeLimit((data ?? []).map(q => q.time_limit_seconds), quizLimit)
  } catch (err) {
    console.error('[social-proof] unexpected time limit error:', err)
    return describeQuestionTimeLimit([], quizLimit)
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name.trim()
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const quizId = searchParams.get('quizId')

  if (!quizId) return emptyResponse()

  try {
    // Hent quiz-vinduet for å filtrere attempts til inneværende kjøring
    const { data: quiz, error: quizError } = await supabaseAdmin
      .from('quizzes')
      .select('opens_at, closes_at, time_limit_seconds, season_points_awarded')
      .eq('id', quizId)
      .single()

    if (quizError || !quiz) return emptyResponse()

    const timeLimitLabel = await effectiveTimeLimitLabel(quizId, quiz.time_limit_seconds)

    let attemptsQuery = supabaseAdmin
      .from('attempts')
      .select('user_id, player_name')
      .eq('quiz_id', quizId)
      .eq('is_team', false)

    if (quiz.opens_at)  attemptsQuery = attemptsQuery.gte('completed_at', quiz.opens_at)
    if (quiz.closes_at) attemptsQuery = attemptsQuery.lte('completed_at', quiz.closes_at)

    const { data: attempts, error: attemptsError } = await attemptsQuery

    if (attemptsError) {
      console.error('[social-proof] attempts query error:', attemptsError)
      return emptyResponse(timeLimitLabel)
    }

    if (!attempts || attempts.length === 0) return emptyResponse(timeLimitLabel)

    // Unike innloggede brukere og unike gjester (player_name uten user_id)
    const loggedInIds = [...new Set(
      attempts.filter(a => a.user_id).map(a => a.user_id as string)
    )]
    const guestNames = [...new Set(
      attempts.filter(a => !a.user_id && a.player_name).map(a => a.player_name as string)
    )]

    // Synlighets-gaten — se toppkommentaren. Gjelder kun innloggede; gjestene
    // over har per definisjon ingen user_id å blokkere på. Lib-en kortslutter
    // selv på tom liste (ingen DB-rundtur), og kaster aldri: ved feil svarer
    // den med hele den spurte lista (fail-stengt), slik at kun gjester vises.
    const blocked = await getGloballyBlockedSet(
      quizId,
      loggedInIds,
      quiz.season_points_awarded === true,
    )
    const visibleLoggedInIds = loggedInIds.filter(id => !blocked.has(id))

    const totalPlayers = visibleLoggedInIds.length + guestNames.length

    // Hent opptil 3 tilfeldige display_name fra profiles
    const sampleNames: string[] = []

    if (visibleLoggedInIds.length > 0) {
      const sample = shuffle(visibleLoggedInIds).slice(0, 3)
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .in('id', sample)

      if (profilesError) {
        console.error('[social-proof] profiles query error:', profilesError)
      } else {
        for (const p of profiles ?? []) {
          if (p.display_name && sampleNames.length < 3) {
            sampleNames.push(firstName(p.display_name))
          }
        }
      }
    }

    // Fyll opp med gjestenavn hvis færre enn 3
    for (const name of shuffle(guestNames)) {
      if (sampleNames.length >= 3) break
      const fn = firstName(name)
      if (fn && !sampleNames.includes(fn)) sampleNames.push(fn)
    }

    return NextResponse.json(
      { totalPlayers, sampleNames, timeLimitLabel },
      { headers: { 'Cache-Control': 'public, s-maxage=60, max-age=0' } }
    )
  } catch (err) {
    console.error('[social-proof] unexpected error:', err)
    return emptyResponse()
  }
}
