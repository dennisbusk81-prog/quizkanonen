import { createSupabaseServer } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getQuestionStatsByAttempts, countActivePlayersSince } from '@/lib/attempt-answer-stats'
import PendingActionRedirect from '@/components/PendingActionRedirect'
import SiteNav from '@/components/SiteNav'
import OrgCard from '@/components/OrgCard'
import LeagueCard, { type LeagueCardData } from '@/components/LeagueCard'
import RivalryCard from '@/components/RivalryCard'
import ErrorBoundary from '@/components/ErrorBoundary'
import WelcomeBanner from '@/components/WelcomeBanner'
import GlobalLeagueChoiceBanner from '@/components/GlobalLeagueChoiceBanner'
import FoundersFarewellBanner from '@/components/FoundersFarewellBanner'
import AccordionSection from '@/components/AccordionSection'
import NotifyForm from '@/components/NotifyForm'
import PushNotificationPrompt from '@/components/PushNotificationPrompt'
import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import type { User } from '@supabase/supabase-js'
import { decideTrialOffer, isTrialEligible, parseTrialDays } from '@/lib/trial-offer'
import { getMonthlyGlobalStandings } from '@/lib/monthly-standings'
import { getLastQuizTop3, type HomeTop3Row } from '@/lib/home-top3'
import { getLeagueCardData } from '@/lib/league-card-data'
import { assertHomeQuery, logHomeQuery } from '@/lib/home-query-guard'
import { onlyRealQuizzes } from '@/lib/real-quiz-population'
import * as Sentry from '@sentry/nextjs'

// Av siden 12. august 2026: Founders-programmet avvikles og trialene
// kanselleres 14.–15. august. Seksjonen under (qk-founders) inviterte aktivt
// med «N av 250 plasser igjen» og «Aktiver gratis tilgang» — begge deler er
// usanne fra og med nedstengningen. Beholdt som flagg framfor å slette
// markupen, siden en ny prøveperiode-inngang bygges oppå denne flaten.
const FOUNDERS_ACTIVE = false

type QuizRow = {
  id: string
  title: string
  allow_teams: boolean
  requires_access_code: boolean
  time_limit_seconds: number | null
  opens_at: string | null
  closes_at: string | null
  questions: { count: number }[]
  attempts: { count: number }[]
}

type MonthEntry = {
  displayName: string
  totalPoints: number
}

function formatNextQuiz(iso: string) {
  const d = new Date(iso)
  const weekday = d.toLocaleDateString('nb-NO', { weekday: 'long', timeZone: 'Europe/Oslo' })
  const day = d.toLocaleDateString('nb-NO', { day: 'numeric', timeZone: 'Europe/Oslo' }).replace(/\.$/, '')
  const month = d.toLocaleDateString('nb-NO', { month: 'long', timeZone: 'Europe/Oslo' })
  const time = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo', hour12: false })
  return `${weekday} ${day}. ${month} kl. ${time} (norsk tid)`
}

// Dager/timer igjen til neste fredag kl. 12 (Oslo-tid) — for "ingen aktiv
// quiz"-meldinger og hero-fallback. Ren datokalkulasjon, ingen DB-avhengighet,
// regnes per forespørsel (ikke live-tikkende, men presist nok til sidelasting).
function getFridayCountdown(now: Date): { label: string; daysUntil: number; hoursUntil: number } {
  const oslo = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }))
  const day = oslo.getDay()
  const hour = oslo.getHours()
  let daysUntil = (5 - day + 7) % 7
  if (daysUntil === 0 && hour >= 12) daysUntil = 7
  const friday = new Date(now)
  friday.setDate(now.getDate() + daysUntil)
  const label = friday.toLocaleDateString('nb-NO', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Oslo',
  }) + ' kl. 12:00'
  const hoursUntil = daysUntil === 0 ? Math.max(1, 12 - hour) : 0
  return { label, daysUntil, hoursUntil }
}

function formatCountdown(daysUntil: number, hoursUntil: number): string {
  return daysUntil > 0
    ? `om ${daysUntil} ${daysUntil === 1 ? 'dag' : 'dager'}`
    : `om ${hoursUntil} ${hoursUntil === 1 ? 'time' : 'timer'}`
}

function truncateName(name: string, max = 20): string {
  if (name.length <= max) return name
  return name.slice(0, max) + '…'
}

// Antall deltakere — samme tellelogikk som /toppliste (api/toppliste, last_quiz-modus):
// distinkte innloggede spillere (is_team=false, user_id ikke null), minus ekskluderte.
//
// KOSMETISK, men med en felle: linja skjules når tallet er 0, så et feilet
// attempts-oppslag degraderer ærlig av seg selv. Det gjør IKKE
// excluded_members-oppslaget — feiler det blir settet tomt og antallet for
// HØYT, uten et eneste tegn på at noe gikk galt. Begge feilene fører derfor
// til 0 (linja forsvinner), aldri til et tall vi ikke kan stå for.
async function countParticipants(quizId: string): Promise<number> {
  const [attemptsRes, excludedRes] = await Promise.all([
    supabaseAdmin
      .from('attempts')
      .select('user_id')
      .eq('quiz_id', quizId)
      .eq('is_team', false)
      .not('user_id', 'is', null),
    supabaseAdmin
      .from('excluded_members')
      .select('user_id')
      .eq('scope_type', 'global')
      .is('scope_id', null),
  ])
  if (logHomeQuery('deltakerantall (attempts)', attemptsRes.error)) return 0
  if (logHomeQuery('deltakerantall (excluded_members)', excludedRes.error)) return 0

  const excludedSet = new Set(((excludedRes.data ?? []) as { user_id: string }[]).map(e => e.user_id))
  const players = new Set<string>()
  for (const r of (attemptsRes.data ?? []) as { user_id: string }[]) {
    if (!excludedSet.has(r.user_id)) players.add(r.user_id)
  }
  return players.size
}

// ── Delt (ikke-personalisert) forsidedata ─────────────────────────────────────
// Identisk for alle besøkende (anonyme og innloggede). Cachet med unstable_cache
// (revalidate 60s) slik at gjentatte besøk ikke trigger nye DB-spørringer.
//
// LEKKASJE-GARANTI: Disse funksjonene tar INGEN bruker-input og leser ALDRI
// cookies/session. De spør kun offentlig, delt innhold via supabaseAdmin. Ingen
// personalisert verdi kan derfor havne i den cachede responsen. Personalisert
// data (profil, ligaer, spilt-status, org-medlemskap) hentes per-request i
// branch-koden under, utenfor cachen.

const QUIZ_CARD_COLS =
  'id, title, allow_teams, requires_access_code, time_limit_seconds, opens_at, closes_at, questions(count), attempts(count)'

type StandingRow = { userId: string; displayName: string; totalPoints: number }
type Top3Row = HomeTop3Row
type SharedHomeData = {
  activeQuiz: QuizRow | null
  upcomingQuiz: QuizRow | null
  lastClosedQuiz: { id: string; title: string; questionsCount: number } | null
  // `nextQuizAt` (site_settings.next_quiz_at) lå her fram til 24. august 2026.
  // Feltet ble satt, cachet og fingeravtrykket — og lest av NULL konsumenter på
  // forsiden. Oppslaget er fjernet med det: én spørring mindre per cache-miss.
  // app/quiz/[id] har sitt eget oppslag mot samme nøkkel og er uberørt.
  founders: { remaining: number; max: number } | null
  // Lengden på den gratis prøveperioden (site_settings.founders_new_trial_days).
  // null = ikke satt/ugyldig → Premium-CTA-ene under viser sin vanlige tekst
  // uten dagtall, aldri et gjettet «14». Delt og upersonlig, derfor trygt i
  // den cachede bundelen; selve KVALIFISERINGEN hentes per bruker utenfor den.
  trialDays: number | null
  monthlyStandings: StandingRow[]
  participantCount: number
  lastQuizTop3: Top3Row[]
}
type PageInsights = {
  easiest: { questionText: string; correctPct: number }
  hardest: { questionText: string; correctPct: number }
}

async function computeSharedHomeData(): Promise<SharedHomeData> {
  const now = new Date()
  const nowIso = now.toISOString()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()


  // «Siste stengte quiz» velges av `order('closes_at', desc)` og er derfor
  // nøyaktig den feilklassen 30ec248 lukket fire andre steder: en testquiz
  // etter QK_TESTQUIZ_OPPSKRIFT er stengt og fersk, og VINNER den sorteringen.
  // Populasjonen kommer nå fra den DELTE definisjonen — `.eq('is_test', false)`
  // matchet dessuten ikke `is_test IS NULL`, og det fantes ingen quiz_type-vakt
  // i det hele tatt.
  //
  // SPØRRINGEN står i en lokal variabel og helperen påføres den — ikke motsatt.
  // Inlinet som ARGUMENT til onlyRealQuizzes() ga TS2589 «Type instantiation is
  // excessively deep» (målt her 25. august 2026, og `npx tsc --noEmit` fanget
  // det). Samme form som de ti andre kallstedene. Ikke inline den tilbake.
  // Helperen må dessuten stå FØR `.maybeSingle()`, som ikke lenger har
  // `.not()`/`.in()` — se lib/real-quiz-population.
  const lastClosedBase = supabaseAdmin
    .from('quizzes')
    // season_points_awarded styrer hvilken gren blokkert-gaten i
    // lib/home-top3 leser fra (persistert vedtak vs. live status).
    .select('id, title, season_points_awarded, questions(count)')
    .lt('closes_at', nowIso)
    .not('closes_at', 'is', null)
    .order('closes_at', { ascending: false })
    .limit(1)

  const lastClosedQuery = onlyRealQuizzes(lastClosedBase).maybeSingle()

  // Alle spørringene går fortsatt PARALLELT — error-lesingen skjer etterpå, på
  // resultatene. Forsidens P95 er 11,37 s (Sentry, ekte brukere); vaktene her
  // koster ingen ekstra rundtur.
  const [activeRes, upcomingRes, lastClosedRes, foundersRes, seasonRes, trialDaysRes] = await Promise.all([
    supabaseAdmin
      .from('quizzes')
      .select(QUIZ_CARD_COLS)
      .eq('is_test', false)
      .lte('opens_at', nowIso)
      .or(`closes_at.is.null,closes_at.gte.${nowIso}`)
      .order('opens_at', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('quizzes')
      .select(QUIZ_CARD_COLS)
      .eq('is_test', false)
      .gt('opens_at', nowIso)
      .or(`closes_at.is.null,closes_at.gte.${nowIso}`)
      .order('opens_at', { ascending: true })
      .limit(1),
    lastClosedQuery,
    (async () => {
      try {
        const { data: settingsRows, error: settingsError } = await supabaseAdmin
          .from('site_settings')
          .select('key, value')
          .in('key', ['founders_max_slots'])
        if (logHomeQuery('founders-plasser (site_settings)', settingsError)) return null
        const rows = (settingsRows ?? []) as { key: string; value: string }[]
        // Uten et innstilt tak i site_settings har vi ingen plassramme å vise —
        // returner null i stedet for et oppdiktet tall (plasslinjen skjules da).
        const rawMax = rows.find(r => r.key === 'founders_max_slots')?.value
        const maxSlots = rawMax != null ? parseInt(rawMax) : NaN
        if (!Number.isFinite(maxSlots)) return null
        const { count, error: countError } = await supabaseAdmin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .in('premium_source', ['founders', 'code'])
          .eq('premium_status', true)
        // Uten denne vakten ble `used` 0 ved lesefeil, og linja påsto «250 av
        // 250 plasser igjen» — et oppdiktet tall, ikke en manglende seksjon.
        if (logHomeQuery('founders-plasser (profiles)', countError)) return null
        const used = count ?? 0
        return { remaining: Math.max(0, maxSlots - used), max: maxSlots }
      } catch {
        return null
      }
    })(),
    // Paginert via lib/monthly-standings (23. august 2026) — spørringen var rå
    // og ville kuttet stille ved 1000 rader (juli målte 279; veksten er reell).
    // Samme synlige degradering som før ved feil: tom liste (seksjonen skjules)
    // — men nå logget, ikke forkledd som en tom måned.
    (async () => {
      try {
        return await getMonthlyGlobalStandings(monthStart, monthEnd)
      } catch (err) {
        console.error('[forside] månedstoppliste feilet:', err)
        return [] as StandingRow[]
      }
    })(),
    supabaseAdmin
      .from('site_settings')
      .select('value')
      .eq('key', 'founders_new_trial_days')
      .maybeSingle(),
  ])

  // ── KRITISK: disse to bestemmer om forsiden i det hele tatt sier at det
  // finnes en quiz ──────────────────────────────────────────────────────────
  // Uten vaktene ble en lesefeil til `data: null`, `?? []` gjorde den til en
  // tom liste, og forsiden skrev «Ingen quiz planlagt akkurat nå» mens quizen
  // var åpen — cachet i 60 sekunder, til alle. Kastet er det som gjør den
  // setningen umulig: kalleren viser en ærlig feiltilstand i stedet, og
  // unstable_cache får ingenting å lagre.
  //
  // Feiler #1 alene er det ikke bedre: da faller kortet ned på «Kommende quiz»
  // — også en usann påstand når quizen er åpen NÅ. Begge må kaste.
  assertHomeQuery('aktiv quiz', activeRes.error)
  assertHomeQuery('kommende quiz', upcomingRes.error)

  const activeQuiz = ((activeRes.data as QuizRow[] | null) ?? [])[0] ?? null
  const upcomingQuiz = ((upcomingRes.data as QuizRow[] | null) ?? [])[0] ?? null

  // ── KOSMETISK: seksjonen forsvinner, ingen påstand blir usann ────────────
  // Uten siste stengte quiz mister vi «Se topplisten»-knappen og «Forrige uke
  // — hvem vant?». Kjedelig, men ærlig. Ikke verdt å felle forsiden for.
  logHomeQuery('siste stengte quiz', lastClosedRes.error)
  const lcq = lastClosedRes.error
    ? null
    : lastClosedRes.data as { id: string; title: string; season_points_awarded: boolean | null; questions: { count: number }[] } | null
  const lastClosedQuiz = lcq
    ? { id: lcq.id, title: lcq.title, questionsCount: lcq.questions?.[0]?.count ?? 0 }
    : null

  const founders = foundersRes
  // Samme parsing som /api/premium/trial-offer og founders-activate krever
  // (positivt heltall) — ellers kunne forsiden lovet en lengde ruten avviser.
  // KOSMETISK: uten dagtall faller CTA-ene til «Premium kr 49/mnd», som er
  // sant uansett. parseTrialDays(undefined) gir null av seg selv.
  logHomeQuery('prøveperiode-lengde', trialDaysRes.error)
  const trialDays = parseTrialDays((trialDaysRes.data as { value: string } | null)?.value)

  // Aggregeringen (per bruker, '—' for tomt navn) ligger i lib/monthly-standings.
  const monthlyStandings: StandingRow[] = seasonRes

  const participantCount = activeQuiz ? await countParticipants(activeQuiz.id) : 0

  // Topp 3 fra siste stengte quiz — blokkert-gatet og rangert i lib/home-top3
  // (24. august 2026): samme gate og samme rangering som /api/leaderboard/[id],
  // siden kortet lenker rett dit. Spørringen her var tidligere rå med
  // .limit(3) og kunne vise en bruker som hadde valgt bort offentlig synlighet.
  // Samme synlige degradering som månedstopplisten over: feil gir tom liste
  // (seksjonen skjules) — logget, ikke forkledd som en tom uke.
  let lastQuizTop3: Top3Row[] = []
  if (lastClosedQuiz) {
    try {
      lastQuizTop3 = await getLastQuizTop3(lastClosedQuiz.id, lcq?.season_points_awarded === true)
    } catch (err) {
      console.error('[forside] topp 3 fra siste quiz feilet:', err)
    }
  }

  return { activeQuiz, upcomingQuiz, lastClosedQuiz, founders, trialDays, monthlyStandings, participantCount, lastQuizTop3 }
}

// tags gjør cachen eksplisitt invaliderbar via revalidateTag (kalt fra
// cron/publish-quiz hvert minutt) i stedet for å stole alene på at
// revalidate-vinduet faktisk trigger en fullført bakgrunnsrevalidering på
// Vercel sin serverless-plattform — se cron/publish-quiz for begrunnelse.
// v2 → v3 fordi returformen fikk et nytt felt (trialDays). Uten bumpen ville
// allerede lagrede v2-objekter blitt servert videre uten feltet, og
// `undefined` leses av decideTrialOffer som «ingen dagangivelse» — CTA-ene
// ville stått med gammel tekst helt til cachen tilfeldigvis rullet.
// v3 → v4 (24. august 2026) av motsatt grunn: formen er uendret, men INNHOLDET
// i lastQuizTop3 er nå blokkert-gatet. Vercels data-cache overlever deploys,
// så uten bumpen kunne en lagret v3-bundel servert det ufiltrerte utvalget i
// opptil ett revalidate-vindu etter at gaten var i drift.
//
// Halen `897f64cc` er et FINGERAVTRYKK av feltsettet funksjonen returnerer,
// ikke en tilfeldig streng. lib/home-shared-cache.test.ts regner den ut fra
// den faktiske returen og krever at nøkkelen her stemmer — endrer du
// feltsettet, ryker testen med den nye halen i feilmeldingen, og bumpen kan
// ikke glemmes. Det er den mekaniske versjonen av regelen i kommentaren over.
//
// v4 → v5 (24. august 2026, F-7). To grunner, og begge krever bumpen:
//   1. Feltsettet krympet — `nextQuizAt` er fjernet (null konsumenter), så
//      halen er 897f64cc → 3893f837.
//   2. Viktigere: en LAGRET v4-bundel kan være regnet ut MENS en spørring
//      feilet, altså en nullbundel som påsto «ingen quiz». Vercels data-cache
//      overlever deploys, og purgen fra cron/publish-quiz griper kun når en
//      quiz er live — uten bumpen kunne nettopp den 60-sekunders-låsen fiksen
//      fjerner blitt båret over deployen. Fra og med v5 KAN en slik bundel
//      ikke finnes: computeSharedHomeData kaster i stedet, og et kast når
//      aldri cacheNewResult().
const getSharedHomeData = unstable_cache(computeSharedHomeData, ['home-shared-data-v5-3893f837'], { revalidate: 60, tags: ['home-shared-data'] })

async function computePageInsights(): Promise<PageInsights | null> {
  const now = new Date()
  try {
    // Embedden brukes KUN som eksistensfilter («har minst ett svar»), men
    // aggregerte tidligere hele undertreet — ~1100 UUID-er / 54,5 kB JSON som
    // ble kastet (målt mot prod 16. august 2026). limit(1) på begge nivåene
    // gjør den til et rent EXISTS-oppslag; INNER JOIN-semantikken (hvilken
    // quiz som velges) er uendret. Samme mønster som toppliste-ruten og
    // org/quiz-scores.
    // is_active her AVVIKER bevisst fra award-season-points-presedensen (som
    // 5cbf976 lente seg på): en skjult quiz skal fortsatt gjøres OPP, men
    // ikke stilles UT — «Skjul» i admin skal fjerne spørsmålene fra forsiden.
    // Besluttet av Dennis 17. august 2026, gjelder både innlogget og utlogget.
    // Samme sortering, samme feilklasse som «siste stengte quiz» over:
    // `attempts!inner` stopper kun en testquiz som ALDRI ble spilt, og
    // oppskriften finnes nettopp for at testquizer SKAL spilles. Populasjonen
    // kommer derfor fra den delte definisjonen. `is_active` er en egen,
    // bevisst avgrensning (se over) og beholdes ved siden av den.
    const closedQuizBase = supabaseAdmin
      .from('quizzes')
      .select('id, attempts!inner(id, attempt_answers!inner(id))')
      .eq('is_active', true)
      .lt('closes_at', now.toISOString())
      .not('closes_at', 'is', null)
      .order('closes_at', { ascending: false })
      .limit(1, { referencedTable: 'attempts' })
      .limit(1, { referencedTable: 'attempts.attempt_answers' })
      .limit(1)

    const closedQuizQuery = onlyRealQuizzes(closedQuizBase)
    const { data: closedQuizRow, error: closedQuizError } = await closedQuizQuery.maybeSingle()

    // KOSMETISK ×3 herfra og ned: hver av de tre feilene ender i den SAMME
    // ærlige degraderingen som et tomt resultat gir — «Ukens fakta»
    // forsvinner, ingen påstand blir usann. Det som manglet var altså ikke
    // degraderingen, men SPORET: fram til 24. august 2026 nådde en feil her
    // verken loggen eller Sentry, og seksjonen kunne stått død i ukevis uten
    // at noen så det.
    if (logHomeQuery('ukens fakta (siste stengte quiz)', closedQuizError)) return null
    if (!closedQuizRow) return null
    const cqId = (closedQuizRow as { id: string }).id
    const { data: attemptRows, error: attemptRowsError } = await supabaseAdmin
      .from('attempts')
      .select('id')
      .eq('quiz_id', cqId)
      .eq('is_team', false)
      .not('user_id', 'is', null)
      .limit(500)

    if (logHomeQuery('ukens fakta (forsøk)', attemptRowsError)) return null
    const attemptIds = ((attemptRows ?? []) as { id: string }[]).map(a => a.id)
    if (attemptIds.length < 3) return null

    const statsMap = await getQuestionStatsByAttempts(attemptIds)
    if (statsMap.size === 0) return null
    const qualified = [...statsMap.entries()]
      .filter(([, s]) => s.total >= 3)
      .map(([qId, s]) => ({ questionId: qId, correctPct: Math.round((s.correct / s.total) * 100) }))
      .sort((a, b) => b.correctPct - a.correctPct)

    if (qualified.length < 2) return null
    const { data: questionRows, error: questionRowsError } = await supabaseAdmin
      .from('questions')
      .select('id, question_text')
      .in('id', qualified.map(q => q.questionId))

    if (logHomeQuery('ukens fakta (spørsmålstekster)', questionRowsError)) return null
    const textMap = new Map(
      ((questionRows ?? []) as { id: string; question_text: string }[]).map(q => [q.id, q.question_text])
    )
    const withText = qualified
      .map(q => ({ questionText: textMap.get(q.questionId) ?? '', correctPct: q.correctPct }))
      .filter(q => q.questionText)

    if (withText.length < 2) return null
    return { easiest: withText[0], hardest: withText[withText.length - 1] }
  } catch (err) {
    // Den ytre grenen fanger noe ANNET enn de tre lesingene over: uventede
    // kast — RPC-fallbackene i lib/attempt-answer-stats som velter,
    // fetchAllRows, en formfeil. Altså ekte bugs, og de hører i Sentry.
    //
    // Volumet er trygt fordi `null` CACHES: computePageInsights ligger i
    // unstable_cache med revalidate 60, så en vedvarende feil koster høyst én
    // hendelse i minuttet per region — ikke én per forsidelast.
    console.error('[forside] ukens fakta feilet uventet — seksjonen skjules:', err)
    try {
      Sentry.captureException(err, { tags: { area: 'home-page-insights' } })
    } catch {
      // Rapporteringen kan ikke rapportere sin egen svikt. Samme mønster som
      // lib/opened-quiz-lookup: forsiden skal ikke falle fordi Sentry er nede.
    }
    return null
  }
}

const getPageInsights = unstable_cache(computePageInsights, ['home-page-insights-v1'], { revalidate: 60, tags: ['home-page-insights'] })

// ── Grunnleggerhistorie-tall ──────────────────────────────────────────────────
// Offentlige, ikke-personaliserte tillitstall til forsidens grunnleggerseksjon.
// Endrer seg sakte (ny fredagsquiz i uken) — revalidate 3600s (1t) er nok,
// ingen grunn til å belaste DB som quiz-dataene.
//
// Definisjoner:
// - quizzesCompleted: COUNT quizzes i den ekte-quiz-populasjonen
//   (onlyRealQuizzes, lib/real-quiz-population) med closes_at i fortiden
// - activePlayers: DISTINCT user_id med minst ett individuelt forsøk
//   (is_team=false, user_id ikke null) siste 12 uker (ett kvartal — matcher
//   Kvartal-periodiseringen i sesong-topplisten, samme spiller-definisjon som
//   countParticipants() over, bare utvidet fra "denne quizen" til et glidende
//   12-ukers vindu i stedet for én enkelt kalendermåned)
//
// Bedriftsantall er bevisst UTELATT — kun én reell betalende kunde per 20. juli
// 2026 gjør et rått tall til svakt sosialt bevis. Legges til igjen når
// kundeantallet faktisk sier noe.
type FounderStoryStats = { quizzesCompleted: number; activePlayers: number }

async function computeFounderStoryStats(): Promise<FounderStoryStats> {
  const twelveWeeksAgo = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()

  // Populasjonen er den DELTE definisjonen, ikke et eget filter. To hull i det
  // gamle `.eq('is_test', false)`: den matchet ikke `is_test IS NULL` (kolonnen
  // er nullable), og det fantes ingen quiz_type-vakt — en arkivquiz med
  // closes_at i fortiden ville blåst opp nettopp det tallet forsiden PÅSTÅR
  // («N+ Quizer gjennomført»).
  //
  // SPØRRINGEN i lokal variabel, helperen påføres den — se TS2589-notatet i
  // lib/real-quiz-population og de ti andre kallstedene. Ikke inline tilbake.
  const quizzesBase = supabaseAdmin
    .from('quizzes')
    .select('id', { count: 'exact', head: true })
    .not('closes_at', 'is', null)
    .lt('closes_at', nowIso)

  const quizzesQuery = onlyRealQuizzes(quizzesBase)

  const [quizzesRes, activePlayers] = await Promise.all([
    quizzesQuery,
    countActivePlayersSince(twelveWeeksAgo),
  ])

  // KRITISK, av nøyaktig samme grunn som founders-plassene i den delte
  // bundelen: uten vakten ble `count` null ved lesefeil, `?? 0` gjorde den til
  // 0, og grunnleggerseksjonen påsto «0+ Quizer gjennomført» — et oppdiktet
  // tall, ikke en manglende seksjon. Verre her enn de fleste steder: med
  // revalidate 3600 ville løgnen stått i en TIME.
  //
  // Et kast er riktig verktøy HER (i motsetning til i den personaliserte
  // grenen i Home()): kallstedet fanger det og skjuler stat-raden, og et kast
  // når aldri cacheNewResult() — se lib/home-query-guard.
  //
  // De to tallene feilet tidligere på hver sin ytterlighet: dette diktet opp
  // en 0, mens countActivePlayersSince KASTER ved total feil og — ufanget på
  // kallstedet — felte hele forsiden. Nå ender begge samme sted.
  assertHomeQuery('quizer gjennomført', quizzesRes.error)

  return {
    quizzesCompleted: quizzesRes.count ?? 0,
    activePlayers,
  }
}

// v2 → v3 (25. august 2026): populasjonen er strammet til onlyRealQuizzes.
// Bumpen gjelder KUN denne cachen, og grunnen er TTL-en: en lagret v2-verdi kan
// være talt opp med det gamle, utette filteret, og med revalidate 3600 ville et
// oppblåst tall stått i en TIME etter deployen. De to andre cachene på forsiden
// (60 s) leger seg selv innen minuttet og er derfor bevisst IKKE bumpet.
//
// v1 → v2 (24. august 2026): returformen er uendret, men en LAGRET v1-verdi
// kan være regnet ut mens quiz-tellingen feilet, altså inneholde det
// oppdiktede `quizzesCompleted: 0`. Vercels data-cache overlever deploys, og
// med revalidate 3600 ville nettopp den timeslange løgnen fiksen fjerner
// blitt båret over deployen. Fra og med v2 KAN en slik verdi ikke finnes:
// computeFounderStoryStats kaster i stedet, og et kast når aldri cachen.
const getFounderStoryStats = unstable_cache(computeFounderStoryStats, ['home-founder-story-stats-v3'], { revalidate: 3600, tags: ['home-founder-story-stats'] })

const SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #1a1c23;
    --card:     #21242e;
    --border:   #2a2d38;
    --gold:     #c9a84c;
    --white:    #ffffff;
    --body:     #e8e4dd;
    --hint:     #918f8a;
    --muted:    #918f8a;
    --radius-card: 16px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .qk-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 20px 80px;
  }

  /* ── Nav ── */
  .qk-nav {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(26,28,35,0.92);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }

  .qk-nav-inner {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 20px;
    height: 54px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .qk-nav-logo {
    font-family: 'Libre Baskerville', serif;
    font-size: 17px;
    font-weight: 700;
    color: var(--white);
    text-decoration: none;
    flex-shrink: 0;
  }

  .qk-nav-logo em { font-style: italic; color: var(--gold); }

  .qk-nav-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .qk-nav-play {
    font-size: 13px;
    font-weight: 600;
    color: var(--body);
    background: transparent;
    text-decoration: none;
    padding: 6px 14px;
    border-radius: var(--radius-btn);
    border: 0.5px solid #2a2d38;
    white-space: nowrap;
    transition: border-color 0.15s, color 0.15s;
  }

  .qk-nav-play:hover {
    border-color: var(--gold);
    color: var(--gold);
  }

  /* ── Hero ── */
  .qk-hero {
    padding: 48px 24px 24px;
    text-align: center;
  }

  .qk-hero-title {
    font-family: 'Libre Baskerville', serif;
    font-size: clamp(28px, 6vw, 44px);
    font-weight: 700;
    color: var(--white);
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin: 0 auto 16px;
    max-width: 540px;
  }

  .qk-hero-title em { font-style: italic; color: var(--gold); }

  .qk-hero-subtitle {
    font-size: 16px;
    color: var(--body);
    opacity: 0.85;
    line-height: 1.6;
    text-align: center;
    margin: 0 auto 24px;
    max-width: 440px;
    padding: 0 16px;
  }

  .qk-hero-actions {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 10px;
  }

  .qk-btn-primary {
    display: inline-flex;
    align-items: center;
    width: auto;
    background: var(--gold);
    color: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 700;
    padding: 10px 28px;
    border-radius: var(--radius-btn);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .qk-btn-primary:hover { background: #d9b85c; }

  .qk-hero-status {
    font-size: 13px;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  /* ── Facts ── */
  .qk-facts {
    display: flex;
    gap: 16px;
    max-width: 680px;
    margin: 0 auto 28px;
    padding: 0 24px;
  }

  .qk-fact {
    flex: 1;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .qk-fact-icon {
    margin-bottom: 12px;
    flex-shrink: 0;
  }

  .qk-fact-title {
    font-size: 14px;
    color: var(--white);
    font-weight: 500;
    margin-bottom: 4px;
  }

  .qk-fact-desc {
    font-size: 12px;
    color: #e8e4dd;
    line-height: 1.5;
  }

  /* ── Divider ── */
  .qk-divider {
    height: 1px;
    background: var(--border);
    max-width: 680px;
    margin: 0 auto 24px;
  }

  /* ── Quiz card ── */
  .qk-card {
    background: var(--card);
    border: 1px solid rgba(201,168,76,0.2);
    border-radius: var(--radius-card);
    padding: 28px 28px 20px;
    margin-bottom: 8px;
    transition: border-color 0.18s;
  }

  .qk-card:hover { border-color: rgba(201,168,76,0.3); }

  .qk-card-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 10px;
  }

  .qk-card-tagline {
    font-size: 13px;
    color: var(--gold);
    margin-top: 8px;
    margin-bottom: 20px;
  }

  .qk-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.2;
    margin-bottom: 0;
    letter-spacing: -0.02em;
  }

  .qk-card-date {
    font-size: 12px;
    color: var(--hint);
    margin-top: 6px;
    margin-bottom: 20px;
  }

  /* ── Topp 3 ── */
  .qk-prev-label {
    font-size: 11px;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    text-align: center;
    margin-bottom: 4px;
  }

  .qk-top3-rows {
    max-width: 360px;
    margin: 0 auto 20px;
  }

  .qk-top3-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(255,255,255,0.02);
    border-radius: 8px;
    margin-bottom: 6px;
  }

  .qk-top3-row:last-child { margin-bottom: 0; }

  .qk-top3-left {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--body);
    min-width: 0;
  }

  .qk-top3-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .qk-top3-right {
    font-size: 12px;
    color: var(--hint);
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .qk-top3-time { margin-left: 4px; }

  /* ── Card actions ── */
  .qk-card-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .qk-card-toplist {
    font-size: 12px;
    color: var(--body);
    text-decoration: none;
    transition: color 0.15s;
  }
  .qk-card-toplist:hover { color: var(--white); }

  .qk-btn-outline-gold {
    display: inline-block;
    background: transparent;
    background-color: transparent;
    border: 1px solid #c9a84c;
    color: #c9a84c;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 10px 28px;
    border-radius: 10px;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
  }

  .qk-btn-outline-gold:hover {
    background: rgba(201,168,76,0.06);
    background-color: rgba(201,168,76,0.06);
  }

  .qk-btn-outline-dark {
    display: inline-block;
    background: transparent;
    border: 1px solid #2a2d38;
    color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    padding: 10px 28px;
    border-radius: 10px;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .qk-btn-outline-dark:hover {
    border-color: #c9a84c;
  }

  /* ── Empty state ── */
  .qk-empty {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 48px 32px;
    text-align: center;
    margin-bottom: 12px;
  }

  .qk-empty-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--white);
    margin-bottom: 8px;
  }

  .qk-empty-sub { font-size: 13px; color: #e8e4dd; line-height: 1.6; }

  /* ── Accordion wrapper ── */
  .qk-acc-wrap {
    max-width: 680px;
    margin: 36px auto;
    padding: 0 24px;
  }

  /* ── Bredde-wrapper for seksjoner uten egen max-width (kommende/denne
     uken/ingen-quiz-kortet, varsle meg, forrige uke, Founders Access) —
     matcher 680px/24px-mønsteret til qk-interlude/qk-preview/
     qk-founder-story/qk-biz/qk-acc-wrap. Legges UTENPÅ elementets
     eksisterende bakgrunn/border/padding — ingen indre spacing endres. ── */
  .qk-narrow-wrap {
    max-width: 680px;
    margin: 0 auto;
    padding: 0 24px;
  }

  /* ── Grunnleggerhistorie — sekundær kort-stil, IKKE gull (to-gule-regel) ── */
  .qk-founder-story {
    max-width: 680px;
    margin: 0 auto 36px;
    padding: 0 24px;
  }

  .qk-founder-story-inner {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 28px;
    text-align: center;
  }

  .qk-founder-story-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--hint);
    margin-bottom: 10px;
  }

  .qk-founder-story-title {
    font-family: 'Libre Baskerville', serif;
    font-size: clamp(18px, 4vw, 20px);
    font-weight: 700;
    color: var(--white);
    line-height: 1.35;
    margin-bottom: 12px;
  }

  .qk-founder-story-body {
    font-size: 14px;
    color: var(--body);
    line-height: 1.65;
    margin-bottom: 20px;
  }

  .qk-founder-story-stats {
    display: flex;
    justify-content: center;
    gap: 28px;
    flex-wrap: wrap;
    margin-bottom: 20px;
    padding-top: 18px;
    border-top: 0.5px solid var(--border);
  }

  .qk-founder-stat-num {
    font-family: 'Libre Baskerville', serif;
    font-size: 22px;
    font-weight: 700;
    color: var(--white);
  }

  .qk-founder-stat-label {
    font-size: 11px;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 2px;
  }

  .qk-founder-story-link {
    font-size: 13px;
    color: #e8e4dd;
    text-decoration: none;
    border-bottom: 1px solid rgba(232,228,221,0.3);
  }

  /* ── Bedrift ── */
  .qk-biz {
    max-width: 680px;
    margin: 0 auto 48px;
    padding: 0 24px;
  }

  .qk-biz-inner {
    background: #1e1a0e;
    border: 1px solid rgba(201,168,76,0.35);
    border-radius: var(--radius-card);
    padding: 28px;
    text-align: center;
  }

  .qk-biz-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    font-weight: 700;
    color: var(--white);
    margin-bottom: 8px;
  }

  .qk-biz-desc {
    font-size: 14px;
    color: var(--body);
    opacity: 0.85;
    margin-bottom: 16px;
    line-height: 1.6;
  }

  .qk-biz-link {
    font-size: 14px;
    color: var(--gold);
    text-decoration: none;
    transition: opacity 0.15s;
  }

  .qk-biz-link:hover { opacity: 0.8; }

  /* ── Founders ── */
  .qk-founders {
    background: #1e1a0e;
    border: 1px solid rgba(201,168,76,0.28);
    border-radius: var(--radius-card);
    padding: 32px 28px;
    margin-bottom: 10px;
  }

  .qk-founders-eyebrow {
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gold);
    margin-bottom: 10px;
  }

  .qk-founders-title {
    font-family: 'Libre Baskerville', serif;
    font-size: clamp(18px, 4vw, 22px);
    font-weight: 700;
    color: var(--white);
    line-height: 1.25;
    letter-spacing: -0.01em;
    margin-bottom: 10px;
  }

  .qk-founders-sub {
    font-size: 14px;
    color: var(--body);
    line-height: 1.6;
    margin-bottom: 20px;
  }

  .qk-founders-btn {
    display: inline-block;
    padding: 10px 28px;
    border: 1px solid #e8e4dd;
    border-radius: 10px;
    color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 700;
    text-decoration: none;
    transition: background 0.15s;
  }

  .qk-founders-btn:hover { background: rgba(232,228,221,0.06); }

  /* ── Personalized dashboard sections ── */
  .qkp-plain-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 28px;
    margin-top: 10px;
  }

  .qkp-section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--hint);
    margin-bottom: 14px;
  }

  .qkp-shortcuts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 10px;
  }

  .qkp-shortcut {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 20px;
    text-align: center;
    text-decoration: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transition: border-color 0.15s;
  }

  .qkp-shortcut:hover { border-color: rgba(201,168,76,0.3); }

  .qkp-shortcut-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--body);
  }

  .qkp-shortcut-arrow { font-size: 12px; color: var(--hint); }

  .qkp-lock-badge {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--gold);
    background: rgba(201,168,76,0.1);
    border: 1px solid rgba(201,168,76,0.2);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .qkp-league-top3 { max-width: none; margin-bottom: 16px; }

  .qkp-greeting { font-size: 28px; }

  /* ── Responsive ── */
  @media (max-width: 600px) {
    .qk-hero { padding: 36px 0 28px; }
    .qk-hero-title { font-size: 32px; }
    .qk-nav-play { display: none; }

    .qk-hero-actions {
      flex-direction: column;
      align-items: stretch;
      max-width: 280px;
      margin-left: auto;
      margin-right: auto;
    }

    .qk-btn-primary,
    .qk-btn-outline-dark {
      text-align: center;
      /* qk-btn-primary er inline-flex: text-align sentrerer ikke flex-innhold,
         så fullbredde-varianten trenger justify-content (synlig først på kort
         tekst som «Bli med»). Harmløs for outline-knappene (inline-block). */
      justify-content: center;
      width: 100%;
    }

    .qk-facts { flex-direction: column; gap: 24px; }

    .qk-fact {
      flex-direction: row;
      align-items: flex-start;
      text-align: left;
      gap: 14px;
    }

    .qk-fact-icon { margin-bottom: 0; }
    .qk-top3-time { display: none; }
  }

  @media (max-width: 540px) {
    .qkp-shortcuts { grid-template-columns: 1fr 1fr; }
    .qkp-shortcut:last-child { grid-column: 1 / -1; }
  }

  /* ── Interlude teaser ── */
  .qk-interlude {
    max-width: 680px;
    margin: 0 auto 28px;
    padding: 0 24px;
  }

  .qk-interlude-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #918f8a;
    margin-bottom: 12px;
    text-align: center;
  }

  .qk-interlude-cards {
    display: flex;
    gap: 12px;
  }

  .qk-interlude-card {
    flex: 1;
    background: #21242e;
    border: 1px solid rgba(201,168,76,0.15);
    border-radius: 16px;
    padding: 20px;
  }

  .qk-interlude-card-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 8px;
    line-height: 1.3;
  }

  .qk-interlude-card-text {
    font-size: 13px;
    color: #e8e4dd;
    line-height: 1.55;
    margin: 0;
  }

  @media (max-width: 600px) {
    .qk-interlude-cards { flex-direction: column; }
  }

  /* ── Visuell forhåndsvisning — fiktivt eksempel, sekundær kortstil, IKKE gull
     (respekterer to-gule-regel: "Spill ukens quiz"/"Se topplisten" er allerede
     det ene gule elementet på denne skjermen) ── */
  .qk-preview {
    max-width: 680px;
    margin: 0 auto 28px;
    padding: 0 24px;
  }

  .qk-preview-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #918f8a;
    margin-bottom: 12px;
    text-align: center;
  }

  .qk-preview-cards {
    display: flex;
    gap: 12px;
  }

  .qk-preview-card {
    flex: 1;
    background: #21242e;
    border: 1px solid #2a2d38;
    border-radius: 16px;
    padding: 20px 16px;
    text-align: center;
  }

  .qk-preview-card-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #918f8a;
    margin-bottom: 12px;
  }

  .qk-preview-card-text {
    font-size: 12px;
    color: #e8e4dd;
    line-height: 1.5;
    margin-top: 10px;
  }

  @media (max-width: 600px) {
    .qk-preview-cards { flex-direction: column; }
  }

  /* ── Desktop ── */
  @media (min-width: 769px) {
    .qk-hero-title    { font-size: 52px; }
    .qk-hero-subtitle { font-size: 18px; }
    .qk-card          { padding: 36px; margin-bottom: 24px; }
    .qk-biz-inner     { padding: 32px; }
    .qkp-greeting     { font-size: 2.4rem; }
    .qkp-plain-card   { margin-top: 24px; }
    .qkp-shortcuts    { margin-top: 24px; }
  }
`

// Feiltilstanden som står DER quiz-kortet ellers står, i begge grenene
// (innlogget og gjest) — én komponent, ikke to JSX-kopier.
//
// Den finnes fordi alternativet var verre: fram til 24. august 2026 degraderte
// en lesefeil til «Ingen quiz planlagt akkurat nå», altså en usann påstand
// presentert som et faktum. Bedre en ærlig feilmelding enn en usann påstand —
// og «ikke hos deg» står der fordi den vanligste reaksjonen ellers er å tro at
// man selv har gjort noe galt. Klassene er alle i SHARED_CSS, som begge
// grenene laster.
function QuizStatusUnavailableCard() {
  return (
    <div className="qk-card">
      <p className="qk-card-eyebrow">Midlertidig feil</p>
      <h2 className="qk-title">Vi får ikke tak i quiz-statusen akkurat nå</h2>
      <p className="qk-empty-sub" style={{ marginTop: 10 }}>
        Det er en midlertidig feil hos oss — ikke hos deg. Last siden på nytt om et øyeblikk.
      </p>
      <div className="qk-card-actions" style={{ marginTop: 16 }}>
        <Link href="/quizer" className="qk-btn-outline-dark">
          Se alle quizer →
        </Link>
      </div>
    </div>
  )
}

export default async function Home() {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
  // Delt av begge grener (innlogget/gjest) under — "ingen aktiv quiz"-tekst + hero-fallback.
  const fridayCountdown = getFridayCountdown(now)

  // Grunnleggerhistorie-tall — delt, ikke-personalisert, brukes i begge
  // grenene under (innlogget/gjest). Cachet (1t), så ett kall her koster
  // ingenting ekstra selv om det havner over begge return-stiene.
  //
  // Den delte forside-bundelen hentes i SAMME Promise.all (24. august 2026).
  // To grunner: begge grenene trenger den, så feilhåndteringen skal finnes ett
  // sted og ikke to; og den lå tidligere som en egen `await` ETTER
  // sesjonslesingen i hver gren — nå er det ett ledd mindre i serie på en side
  // med P95 11,37 s.
  //
  // `shared` er null KUN når en KRITISK spørring feilet (computeSharedHomeData
  // kaster da — se lib/home-query-guard). Kosmetiske feil er allerede
  // degradert inne i bundelen. Null betyr derfor «vi vet ikke om det finnes en
  // quiz», og det er en tredje tilstand — ikke «det finnes ingen».
  const [founderStats, shared] = await Promise.all([
    // Fanges her av samme grunn som den delte bundelen rett under: begge
    // feilveiene i computeFounderStoryStats (kastet fra quiz-tellingen, og et
    // kast fra countActivePlayersSince når både RPC-en og den paginerte
    // fallbacken svikter) ville ellers falt helt til app/global-error.tsx —
    // det finnes ingen app/error.tsx — og byttet ut HELE forsiden med «Noe
    // gikk galt». To tillitstall er ikke verdt en forside. null ⇒ stat-raden
    // skjules, resten av grunnleggerseksjonen står.
    getFounderStoryStats().catch((err): null => {
      console.error('[forside] grunnleggertall utilgjengelig — stat-raden skjules:', err)
      return null
    }),
    getSharedHomeData().catch((err): null => {
      console.error('[forside] delt bundel utilgjengelig — viser ærlig feiltilstand:', err)
      return null
    }),
  ])
  const sharedUnavailable = shared === null

  // ── Session check via cookie-based Supabase SSR client ──
  // Middleware (middleware.ts) already called getUser() on this same request,
  // which validates + refreshes the token cookie. Reading getSession() here is
  // then a local cookie read — the JWT is Supabase-signed, so the user.id is
  // trustworthy for personalizing content. MEN «lokal lesing» gjelder bare når
  // middleware nettopp lyktes: på et UTLØPT token gjør getSession() sitt eget
  // refresh-kall mot GoTrue, og auth-js har ingen fetch-timeout.
  //
  // Derfor: satte middleware `x-qk-auth: unknown` (getUser() fikk ikke svar
  // innen fristen, eller cookie-vakten blokkerte en utlogging), hoppes
  // getSession() over HELT — å spørre selv ville gjentatt nøyaktig det
  // hengende kallet, med render-budsjettet (300 s, målt 14. august 2026) i
  // stedet for middlewarens 25 s. Ukjent er en TREDJE tilstand, ikke «gjest»:
  // gjeste-oppsettet rendres, men uten påstandene om at brukeren er utlogget
  // (se authUnknown-forgreningene i JSX-en). Samme prinsipp som
  // lib/has-settled-plays.ts — når vi ikke VET, handler vi ikke som om vi
  // visste det verste. Headeren kan ikke settes utenfra: middleware stripper
  // innkommende `x-qk-auth` ubetinget før den eventuelt setter sin egen.
  const authUnknown = (await headers()).get('x-qk-auth') === 'unknown'

  let user: User | null = null
  if (!authUnknown) {
    const supabaseServer = await createSupabaseServer()
    const { data: { session } } = await supabaseServer.auth.getSession()
    user = session?.user ?? null
  }

  // ══════════════════════════════════════════════════════════
  // PERSONALIZED VIEW — logged-in users
  // ══════════════════════════════════════════════════════════
  if (user) {
    type LeagueMemberRow = { league_id: string; leagues: { id: string; name: string } | null }

    // Delt, ikke-personalisert data (quiz-kort, månedlig global toppliste,
    // deltakerantall, siste quiz) kommer fra den cachede bundelen som ble hentet
    // over — identisk for alle og trygt å dele. Personaliserte spørringer kjøres
    // per-request under.

    const [profileResult, leagueResult, playedLogResult, monthlyAttemptsResult, orgMembershipResult] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('display_name, premium_status, has_used_trial')
        .eq('id', user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('league_members')
        .select('league_id, leagues(id, name)')
        .eq('user_id', user.id)
        .limit(5),
      // For logged-in users, attempts table is the authoritative source (mirrors quiz/[id]/page.tsx logic)
      supabaseAdmin
        .from('attempts')
        .select('quiz_id, submitted_at')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false })
        .limit(10),
      // Has the user played any quiz this calendar month?
      supabaseAdmin
        .from('attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('completed_at', monthStart)
        .lt('completed_at', monthEnd),
      // Org-medlemskap — for kontekstuell "Se topplisten" når quizen er stengt
      supabaseAdmin
        .from('organization_members')
        .select('organizations(slug)')
        .eq('user_id', user.id),
    ])

    // ── Lesevakter for de fem personaliserte spørringene ────────────────
    //
    // Her KASTER vi ikke, i motsetning til den delte bundelen. Forskjellen er
    // ikke smak: disse fem ligger rått i Home(), utenfor både unstable_cache
    // og et .catch, og det finnes ingen app/error.tsx. Et kast herfra faller
    // helt til app/global-error.tsx og bytter ut HELE siden med «Noe gikk
    // galt» — nav, hero, Ukens fakta, grunnleggerseksjon, alt. Der
    // computeSharedHomeData mister ETT kort, mister vi hele forsiden.
    //
    // Vakten gjør derfor den enkelte PÅSTANDEN umulig i stedet, som en tredje
    // tilstand i JSX-en under. Regelen fra lib/home-query-guard er den samme;
    // det er degraderingen som må passe kallstedet.
    const premiumUnknown = logHomeQuery('profil (innlogget)', profileResult.error)
    // KOSMETISK: liga-kortet rendres bak en length > 0-vakt, så en lesefeil
    // skjuler seksjonen av seg selv. Ingen «du har ingen ligaer»-tekst finnes.
    logHomeQuery('mine ligaer (league_members)', leagueResult.error)
    const playedStatusUnknown = logHomeQuery('spilt-status (attempts)', playedLogResult.error)
    const playedThisMonthUnknown = logHomeQuery('spilt denne måneden (attempts)', monthlyAttemptsResult.error)
    // KOSMETISK: uten org-medlemskapet peker «Se topplisten» til
    // quiz-topplista i stedet for bedriftssiden. Lenken er gyldig, bare
    // mindre kontekstuell — ingen påstand blir usann.
    logHomeQuery('org-medlemskap (organization_members)', orgMembershipResult.error)

    // Profile
    const profile = profileResult.data
    const isPremium = profile?.premium_status === true
    // «Nedgraderer aldri på transient feil» — regelen ProfileProvider har
    // fulgt hele tiden, nå håndhevet på forsiden også. Landet ikke
    // profiloppslaget, er Premium UKJENT, ikke «gratis»: en betalende kunde
    // skal aldri se «Oppgrader til Premium», et lås-merke på Historikk eller
    // fordels-seksjonen som forteller henne hva hun går glipp av.
    //
    // Merk asymmetrien — den er med vilje. INNHOLDET forblir fail-closed:
    // ukjent gir fortsatt gratis-visningen («blant de N beste», ikke nøyaktig
    // plassering), for en lesefeil skal ikke åpne en Premium-flate. Det er
    // kun PÅSTANDEN OM KONTOEN som skjules. Samme skille som ellers: klienten
    // er visning, ruten er porten.
    //
    // Et manglende profilrad-treff (error null, data null) er IKKE ukjent —
    // da finnes det ingen konto å nedgradere, og oppsalget er sant.
    const premiumLocked = !isPremium && !premiumUnknown
    // Prøveperiode-tilbudet for DENNE brukeren. Avgjort server-side her — vi
    // har allerede profilraden, så CTA-ene under trenger verken en
    // klient-komponent eller et ekstra kall.
    //
    // Feilet oppslaget (`profile` er null) er `eligible` bevisst null = UKJENT,
    // ikke false: da vises tilbudet, og founders-activate — som er fail-CLOSED
    // på samme rad — avviser om den må. Klientsjekken er visning, ruten er
    // gaten.
    const trialOffer = decideTrialOffer({
      trialDays: shared?.trialDays ?? null,
      eligible: profile
        ? isTrialEligible({ isPremium, hasUsedTrial: profile.has_used_trial === true })
        : null,
    })
    const displayName = profile?.display_name ?? user.email?.split('@')[0] ?? 'der'
    const firstName = displayName.split(' ')[0]

    // Quiz — aktiv (fra delt cache). null når bundelen er utilgjengelig, men
    // da rendres QuizStatusUnavailableCard i stedet for kortet under, så
    // «ingen quiz»-grenen er ikke nåbar.
    const quiz = shared?.activeQuiz ?? null

    // Siste stengte quiz — "Se topplisten"-mål når ingen aktiv quiz finnes
    const lastClosedQuizId = shared?.lastClosedQuiz?.id ?? null

    // Org-medlemskap — er brukeren med i nøyaktig én org, lenker "Se topplisten"
    // (når quizen er stengt) til bedriftens side i stedet for quiz-topplisten.
    // Flere orger eller ingen ⇒ behold dagens leaderboard-lenke.
    type OrgSlugRow = { organizations: { slug: string } | { slug: string }[] | null }
    const orgSlugs = ((orgMembershipResult.data as OrgSlugRow[] | null) ?? [])
      .map(r => Array.isArray(r.organizations) ? r.organizations[0]?.slug : r.organizations?.slug)
      .filter((sl): sl is string => !!sl)
    const singleOrgToplistHref = orgSlugs.length === 1 ? `/org/${orgSlugs[0]}` : null

    // Kommende quiz (fra delt cache) — vises kun når ingen aktiv finnes
    const upcomingQuiz: QuizRow | null = quiz ? null : (shared?.upcomingQuiz ?? null)

    const participantCount = shared?.participantCount ?? 0

    // Has the user already played the active quiz?
    //
    // playedStatusUnknown står FØRST i CTA-kjeden i JSX-en under, og må bli
    // stående der. Fram til 24. august 2026 falt en lesefeil her helt ned i
    // «Spill ukens quiz» — vi lokket en som ALLEREDE hadde spilt inn i
    // allerede-spilt-skjermen eller en 403. Begge flaggene under er `false`
    // ved feil (data er null), og det er nettopp derfor de ikke kan brukes
    // til å skille «har ikke spilt» fra «vi vet ikke».
    type PlayedRow = { quiz_id: string; submitted_at: string | null }
    const attemptRows = (playedLogResult.data as PlayedRow[] | null) ?? []
    const myActiveAttempt = quiz ? attemptRows.find(r => r.quiz_id === quiz.id) : null
    const alreadyPlayed = myActiveAttempt?.submitted_at != null
    const hasUnfinished = myActiveAttempt != null && myActiveAttempt.submitted_at == null

    // Season — fra delt cache (offentlig månedlig global toppliste). Brukerens
    // egen rang utledes lokalt fra den delte lista (userId er offentlig toppliste-
    // info — ingen privat data i cachen).
    const standings = shared?.monthlyStandings ?? []
    const userRankIdx  = standings.findIndex(s => s.userId === user.id)
    const userRank     = userRankIdx === -1 ? 0 : userRankIdx + 1
    const userPoints   = standings.find(s => s.userId === user.id)?.totalPoints ?? 0
    // Round up to nearest 5 for the free-user estimate
    const estimatedBest = userRank > 0 ? Math.max(5, Math.ceil(userRank / 5) * 5) : 0
    const monthlyTop3: MonthEntry[] = standings.slice(0, 3).map(s => ({ displayName: s.displayName, totalPoints: s.totalPoints }))

    const playedThisMonth = (monthlyAttemptsResult.count ?? 0) > 0

    const monthName = now.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' })

    // Leagues — hent data for alle ligaer brukeren er med i, parallelt
    const leagueRows = (leagueResult.data as LeagueMemberRow[] | null) ?? []
    const allLeagues = leagueRows
      .map(r => r.leagues)
      .filter((l): l is { id: string; name: string } => l !== null)

    // Spørringene ligger i lib/league-card-data (paginert + chunket, 23. august
    // 2026). Fanges per kort: én ligas lesefeil skal koste DET kortet (tomt,
    // som før — men logget), ikke hele forsiden.
    const leagueDataArr: LeagueCardData[] = await Promise.all(
      allLeagues.map(async (league) => {
        try {
          return await getLeagueCardData(league, quiz?.id ?? null, monthStart, monthEnd)
        } catch (err) {
          console.error(`[forside] liga-kort feilet league=${league.id}:`, err)
          return { id: league.id, name: league.name, top3: [], fromFallback: false }
        }
      })
    )

    const todayLabel = now.toLocaleDateString('nb-NO', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo',
    })

    // ── Quiz insights (delt, cachet) ──
    const pageInsights = await getPageInsights()

    return (
      <>
        <style>{SHARED_CSS}</style>
        <PendingActionRedirect />

        <SiteNav quizId={quiz?.id} />

        <div className="qk-page">

          {/* Global liga-valg — vises kun til org-medlemmer som ikke har besvart */}
          <ErrorBoundary>
            <GlobalLeagueChoiceBanner />
          </ErrorBoundary>

          {/* Welcome */}
          <section style={{ paddingTop: 40, paddingBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
              <h1 className="qkp-greeting" style={{
                fontFamily: "'Libre Baskerville', serif",
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1.2,
              }}>
                Hei, {firstName}!
              </h1>
              {isPremium && (
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#c9a84c',
                  background: 'rgba(201,168,76,0.12)',
                  border: '1px solid rgba(201,168,76,0.28)',
                  borderRadius: 999,
                  padding: '3px 10px',
                }}>
                  Premium
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: '#918f8a' }}>{todayLabel}</p>
          </section>

          {/* Rivalry card — innkommende utfordring vises høyt opp */}
          <ErrorBoundary>
            <RivalryCard prioritySlot="top" />
          </ErrorBoundary>

          {/* Quiz card */}
          {/* sharedUnavailable FØRST i kjeden: uten den ville en lesefeil falt
              helt ned i «Ingen quiz planlagt akkurat nå» — den ene setningen
              som ikke får være usann. Se lib/home-query-guard. */}
          {sharedUnavailable ? (
            <QuizStatusUnavailableCard />
          ) : quiz ? (
            <div className="qk-card">
              <p className="qk-card-eyebrow">Denne uken</p>
              <h2 className="qk-title">{quiz.title}</h2>
              <p className="qk-card-tagline">
                {participantCount > 0 ? `${participantCount} deltakere · Kan du slå dem?` : 'Kan du slå dem?'}
              </p>
              {monthlyTop3.length > 0 && (
                <div style={{ margin: '14px 0 2px' }}>
                  <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 10 }}>
                    Månedens toppliste
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {monthlyTop3.map((entry, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, color: '#918f8a', width: 16, flexShrink: 0, fontWeight: 600 }}>{i + 1}.</span>
                        <span style={{ fontSize: 13, color: '#e8e4dd', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {truncateName(entry.displayName)}
                        </span>
                        <span style={{ fontSize: 12, color: '#c9a84c', flexShrink: 0, fontWeight: 600 }}>{entry.totalPoints} p</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="qk-card-actions">
                {/* playedStatusUnknown FØRST i kjeden, av samme grunn som
                    sharedUnavailable står først rundt hele kortet: uten den
                    faller en lesefeil ned i «Spill ukens quiz», og en som har
                    spilt lokkes inn i en vegg. Kortet ellers er delt data og
                    fortsatt gyldig, så vi beholder det — det er bare
                    handlingen som ikke kan påstå noe. */}
                {playedStatusUnknown ? (
                  <>
                    <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 10 }}>
                      Vi fikk ikke sjekket om du har spilt denne uken.
                    </p>
                    <Link href={`/quiz/${quiz.id}`} className="qk-btn-outline-gold">
                      Åpne ukens quiz →
                    </Link>
                  </>
                ) : alreadyPlayed ? (
                  <>
                    <p style={{ fontSize: 14, color: '#e8e4dd' }}>Du har allerede spilt denne uken</p>
                    <Link href={`/leaderboard/${quiz.id}`} className="qk-btn-outline-gold">
                      Se topplisten →
                    </Link>
                  </>
                ) : hasUnfinished ? (
                  <Link href={`/quiz/${quiz.id}`} className="qk-btn-primary">
                    Fortsett quizen →
                  </Link>
                ) : (
                  <>
                    <p style={{ fontSize: 14, color: '#e8e4dd', marginBottom: 10 }}>Ukens quiz venter på deg.</p>
                    <Link href={`/quiz/${quiz.id}`} className="qk-btn-primary">
                      Spill ukens quiz
                    </Link>
                  </>
                )}
              </div>
            </div>
          ) : upcomingQuiz ? (
            <div className="qk-card">
              <p className="qk-card-eyebrow">Kommende quiz</p>
              <h2 className="qk-title">{upcomingQuiz.title}</h2>
              <p className="qk-card-date">
                Åpner {upcomingQuiz.opens_at ? formatNextQuiz(upcomingQuiz.opens_at) : 'snart'}
              </p>
              {(lastClosedQuizId || singleOrgToplistHref) && (
                <div className="qk-card-actions">
                  <Link href={singleOrgToplistHref ?? `/leaderboard/${lastClosedQuizId}`} className="qk-btn-primary">
                    Se topplisten
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="qk-empty">
              <p className="qk-empty-title">Ingen quiz planlagt akkurat nå</p>
              <p className="qk-empty-sub">
                Neste fredagsquiz kommer snart. Ny quiz åpner fredag kl. 12 — {formatCountdown(fridayCountdown.daysUntil, fridayCountdown.hoursUntil)}.
              </p>
              {(lastClosedQuizId || singleOrgToplistHref) && (
                <div className="qk-card-actions" style={{ marginTop: 16 }}>
                  <Link href={singleOrgToplistHref ?? `/leaderboard/${lastClosedQuizId}`} className="qk-btn-primary">
                    Se topplisten
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Founders-farvel — engangsmelding til tidligere Founders-brukere
              uten Premium-dekning; gate og «vises kun én gang»-stempel i
              lib/founders-farewell.ts + founders-farewell-seen-ruta. Står
              BEVISST rett under quiz-kortet/nedtellingen: quizen er
              hovedsaken, dette er en beskjed ved siden av — ikke flytt den
              over quiz-kortet. */}
          <ErrorBoundary>
            <FoundersFarewellBanner />
          </ErrorBoundary>

          {/* Se alle quizer */}
          <div style={{ textAlign: 'center', marginTop: 8, marginBottom: 4 }}>
            <Link href="/quizer" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
              Se alle quizer →
            </Link>
          </div>

          {/* Ukens fakta — quiz insights. Vises så snart en stengt quiz har
              nok svar — også fredag mens en quiz er åpen (innholdet er da fra
              forrige stengte quiz). */}
          {pageInsights && (
            <div style={{
              marginTop: 16, marginBottom: 4, textAlign: 'center',
              background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16,
              padding: '20px 24px',
            }}>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 10 }}>
                Ukens fakta
              </p>
              <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 6 }}>
                {pageInsights.easiest.correctPct}% svarte riktig på ukens letteste:{' '}
                <span style={{ fontStyle: 'italic' }}>{pageInsights.easiest.questionText}</span>
              </p>
              <p style={{ fontSize: 14, color: '#c9a84c', lineHeight: 1.6 }}>
                Kun {pageInsights.hardest.correctPct}% klarte:{' '}
                <span style={{ fontStyle: 'italic' }}>{pageInsights.hardest.questionText}</span>
              </p>
            </div>
          )}

          {/* Org card — bedriftsliga, kun for org-medlemmer */}
          <ErrorBoundary>
            <OrgCard />
          </ErrorBoundary>

          {/* Season placement card */}
          <div className="qkp-plain-card">
            <p className="qkp-section-label">Sesong — {monthName}</p>

            {isPremium && userPoints > 0 && (
              <p style={{ fontSize: 16, color: '#ffffff', lineHeight: 1.5 }}>
                Du er på{' '}
                <strong style={{ color: '#c9a84c' }}>{userRank}. plass</strong>
                {' '}denne måneden
                <span style={{ color: '#e8e4dd' }}> · {userPoints} poeng</span>
              </p>
            )}
            {/* !playedThisMonthUnknown på begge de to setningene under: de er
                de eneste stedene playedThisMonth havner på skjermen, og ved
                lesefeil ble count null ⇒ false ⇒ «Du er ikke i gang denne
                måneden ennå» til en som spilte i går. Samme klasse som «250
                av 250 plasser igjen»: en påstand, ikke en manglende seksjon.
                Uten svaret sier vi ingenting — etiketten og «Se nøyaktig
                plassering →» står igjen. */}
            {isPremium && userPoints === 0 && !playedThisMonthUnknown && (
              <p style={{ fontSize: 15, color: '#e8e4dd' }}>
                {playedThisMonth
                  ? 'Du har spilt denne måneden — resultatet blir endelig når quizen stenger'
                  : 'Du har ikke spilt denne måneden ennå'}
              </p>
            )}
            {!isPremium && userPoints > 0 && (
              <p style={{ fontSize: 15, color: '#e8e4dd' }}>
                Du er blant de{' '}
                <strong style={{ color: '#ffffff' }}>{estimatedBest}</strong>
                {' '}beste denne måneden
              </p>
            )}
            {!isPremium && userPoints === 0 && !playedThisMonthUnknown && (
              <p style={{ fontSize: 15, color: '#e8e4dd' }}>
                {playedThisMonth
                  ? 'Du har spilt denne måneden — resultatet blir endelig når quizen stenger'
                  : 'Du er ikke i gang denne måneden ennå — bli med på fredag!'}
              </p>
            )}

            <div style={{
              marginTop: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}>
              <Link href="/toppliste" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                Se nøyaktig plassering →
              </Link>
              {premiumLocked && (
                <Link href="/premium" className="qk-btn-outline-gold" style={{ fontSize: 13, padding: '7px 18px' }}>
                  {trialOffer.show ? `Prøv Premium gratis i ${trialOffer.days} dager` : 'Oppgrader til Premium'}
                </Link>
              )}
            </div>
          </div>

          {/* Shortcut grid */}
          <div className="qkp-shortcuts">
            <Link href="/toppliste" className="qkp-shortcut">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="13" width="4" height="7" rx="1"/>
                <rect x="9" y="8" width="4" height="12" rx="1"/>
                <rect x="16" y="3" width="4" height="17" rx="1"/>
              </svg>
              <span className="qkp-shortcut-label">Sesongtoppliste</span>
              {isPremium && userPoints > 0 && (
                <span style={{ fontSize: 12, color: '#918f8a', marginTop: -4 }}>{userRank}. plass — {userPoints} poeng</span>
              )}
              <span className="qkp-shortcut-arrow">→</span>
            </Link>

            <Link href="/liga" className="qkp-shortcut">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="6" r="3"/>
                <circle cx="4" cy="14" r="2.5"/>
                <circle cx="18" cy="14" r="2.5"/>
                <path d="M7.5 8.5C5.5 9.5 4 11.5 4 14"/>
                <path d="M14.5 8.5C16.5 9.5 18 11.5 18 14"/>
              </svg>
              <span className="qkp-shortcut-label">Mine ligaer</span>
              <span className="qkp-shortcut-arrow">→</span>
            </Link>

            {/* premiumLocked, ikke !isPremium: ved ukjent profil peker flisa
                til /historikk, som gater ærlig server-side og sier fra selv.
                Et lås-merke ville derimot påstått noe vi ikke vet. */}
            <Link
              href={premiumLocked ? '/premium' : '/historikk'}
              className="qkp-shortcut"
              style={{ opacity: premiumLocked ? 0.7 : 1 }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={premiumLocked ? '#918f8a' : '#c9a84c'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="M11 7v4l3 2"/>
              </svg>
              <span className="qkp-shortcut-label" style={{ color: '#e8e4dd' }}>
                Historikk
              </span>
              {!premiumLocked
                ? <span className="qkp-shortcut-arrow">→</span>
                // Lås-merket, ikke en CTA — derfor den korte varianten. En full
                // «Prøv Premium gratis i N dager» ville brukket over flere
                // linjer i flisa; her endres kun ordet, ikke layouten.
                : <span className="qkp-lock-badge">{trialOffer.show ? 'Prøv gratis' : 'Premium'}</span>
              }
            </Link>
          </div>

          {/* Premium-fordeler — kun for ikke-Premium-brukere */}
          {premiumLocked && (
            <div style={{
              background: '#21242e',
              border: '1px solid #2a2d38',
              borderRadius: 16,
              padding: '20px 24px',
              marginTop: 10,
            }}>
              <p style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#918f8a',
                marginBottom: 12,
              }}>
                Dette får du med Premium
              </p>
              {/* Kjernesetningen — innledning til punktene under, ikke en
                  erstatning for dem. Kortets egen tittel-typografi. */}
              <p style={{
                fontFamily: "'Libre Baskerville', serif",
                fontSize: 16,
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1.35,
                margin: '0 0 14px',
              }}>
                Premium for deg som vil mer enn bare svare riktig
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  'Nøyaktig plassering på leaderboard',
                  'Full sesong-toppliste — søk og bla gjennom alle spillere',
                  'Historikk og statistikk — beste plassering, streak og utvikling over tid',
                  'Private ligaer med venner',
                  'Se nøyaktig hvilke spørsmål du svarte feil på, uke for uke',
                  // «hvert spørsmål» var usant — ruten leverer bevisst 2+2
                  // (sikkerhetsbeslutning 26. juli); ordlyd fra /leaderboard/[id].
                  'Svarfordeling — se hvordan alle svarte på ukens letteste og vanskeligste spørsmål',
                ] as const).map(f => (
                  <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#e8e4dd', lineHeight: 1.5 }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginTop: 2, flexShrink: 0 }}>
                      <circle cx="7" cy="7" r="6.5" stroke="#c9a84c" strokeWidth="1"/>
                      <path d="M4.5 7L6.5 9L9.5 5.5" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/premium" style={{
                display: 'inline-block',
                fontSize: 13,
                fontWeight: 600,
                color: '#e8e4dd',
                border: '1px solid #2a2d38',
                borderRadius: 10,
                padding: '8px 20px',
                textDecoration: 'none',
                fontFamily: "'Instrument Sans', sans-serif",
              }}>
                {trialOffer.show ? `Prøv Premium gratis i ${trialOffer.days} dager →` : 'Se Premium →'}
              </Link>
            </div>
          )}

          {/* League card — klient-komponent for at velger + localStorage skal fungere */}
          {leagueDataArr.length > 0 && (
            <LeagueCard leagues={leagueDataArr} />
          )}

          {/* Rivalry card — H2H Duell (gratis), alle tilstander unntatt incoming */}
          <ErrorBoundary>
            <RivalryCard prioritySlot="default" />
          </ErrorBoundary>

        </div>
      </>
    )
  }

  // ══════════════════════════════════════════════════════════
  // DEFAULT VIEW — not logged in (original homepage, unchanged)
  // ══════════════════════════════════════════════════════════

  // Ukens fakta — samme delte unstable_cache-bundel som den innloggede grenen
  // (60 s), så dette er en cache-lesing, ikke en ny spørring.
  const pageInsights = await getPageInsights()

  // `shared` er hentet øverst i Home(), felles for begge grenene. Null =
  // kritisk lesefeil ⇒ QuizStatusUnavailableCard, ikke «ingen quiz».
  const activeQuiz   = shared?.activeQuiz ?? null
  const upcomingQuiz = shared?.upcomingQuiz ?? null
  const activeParticipantCount = shared?.participantCount ?? 0
  const foundersSettingsResult = shared?.founders ?? null

  // Månedlig global topp 3 (anon) — filtrer bort tomme/manglende navn (som før),
  // deretter slice topp 3.
  const anonMonthlyTop3: MonthEntry[] = (shared?.monthlyStandings ?? [])
    .filter(s => s.displayName && s.displayName !== '—')
    .slice(0, 3)
    .map(s => ({ displayName: s.displayName, totalPoints: s.totalPoints }))

  // Siste stengte quiz + topp 3 (fra delt cache)
  const lastQuiz = shared?.lastClosedQuiz ?? null
  const lastQuizQuestionCount = shared?.lastClosedQuiz?.questionsCount ?? 0
  const lastQuizTop3 = shared?.lastQuizTop3 ?? []

  // Prøveperiode-tilbudet på den UTLOGGEDE forsiden. `eligible: null` er ikke en
  // mangel her — det er den riktige verdien: uten sesjon finnes det ingen profil
  // å lese `has_used_trial` fra, og `decideTrialOffer` viser da tilbudet og lar
  // founders-activate være gaten (se toppkommentaren i lib/trial-offer.ts).
  // Dagtallet er samme kilde som den innloggede grenen bruker
  // (site_settings.founders_new_trial_days, allerede i home-shared-bundelen —
  // en global verdi, ikke brukerspesifikk, så ingen ekstra oppslag). Mangler
  // tallet, faller linja tilbake til «Premium kr 49/mnd».
  const anonTrialOffer = decideTrialOffer({ trialDays: shared?.trialDays ?? null, eligible: null })

  return (
    <>
      <style>{SHARED_CSS}</style>

      <PendingActionRedirect />

      <SiteNav quizId={activeQuiz?.id} />

      <WelcomeBanner />

      <div className="qk-page">

        {/* ── Hero ── */}
        <section className="qk-hero">
          <h1 className="qk-hero-title">
            Én ny quiz. De samme rivalene. <em>Hver fredag.</em>
          </h1>
          <p className="qk-hero-subtitle">
            Svar på 15 spørsmål, se hvor du ligger og klatre på topplisten gjennom sesongen.
          </p>
          <div className="qk-hero-actions">
            {/* Ved kritisk lesefeil skjules hele quiz-avhengige knappeparet.
                «Varsle meg» (anker til påmeldingsskjemaet) og «Bli med» er
                begge stille påstander om at det ikke er noe å spille NÅ — og
                det vet vi ikke. Samme prinsipp som authUnknown-grenene rett
                under: vi viser ikke en påstand vi ikke kan stå for. Kortet
                lenger nede bærer handlingen i den tilstanden. */}
            {!sharedUnavailable && (activeQuiz ? (
              // Fredag (åpen quiz): spilling er primærhandlingen, ikke
              // registrering — og lenken går allerede via /login for
              // utloggede, så «å bli med» skjer på veien inn i quizen.
              // Ingen egen «Bli med»-knapp denne dagen (aldri to gull).
              //
              // Ukjent auth: hopp over /login-omveien — «Logg inn og spill» er
              // en påstand om at brukeren er utlogget, og det vet vi ikke.
              // Quiz-siden håndterer auth selv (samme mål som «Spill nå»-
              // knappen i quiz-kortet lenger ned).
              <Link
                href={authUnknown ? `/quiz/${activeQuiz.id}` : `/login?next=/quiz/${activeQuiz.id}`}
                className="qk-btn-primary"
              >
                Spill ukens quiz
              </Link>
            ) : (
              <>
                {/* Stengte dager: «Bli med» er gull-primær — men den er også
                    en påstand om at brukeren er utlogget, så ved ukjent auth
                    skjules den og «Se resultatene» beholder gullrollen som
                    før (samme prinsipp som hero-statuslinjen under). */}
                {!authUnknown && (
                  <Link href="/login" className="qk-btn-primary">
                    Bli med
                  </Link>
                )}
                {lastQuiz ? (
                  <Link
                    href={`/leaderboard/${lastQuiz.id}`}
                    className={authUnknown ? 'qk-btn-primary' : 'qk-btn-outline-dark'}
                  >
                    Se resultatene
                  </Link>
                ) : (
                  <a
                    href="#varsle-meg"
                    className={authUnknown ? 'qk-btn-primary' : 'qk-btn-outline-dark'}
                  >
                    Varsle meg
                  </a>
                )}
              </>
            ))}
            <Link href="/slik-fungerer-det" className="qk-btn-outline-dark">
              Slik fungerer det →
            </Link>
          </div>
          {authUnknown ? (
            /* Ukjent-linjen står der premium-påstanden ellers ville stått.
               Ordlyd godkjent av Dennis 16. august 2026 — endre den ikke
               uten ny godkjenning. */
            <div className="qk-hero-status">
              <span style={{ color: '#918f8a' }}>
                Vi får ikke kontakt med innloggingen akkurat nå. Er du innlogget, er du det fortsatt — last siden på nytt om litt.
              </span>
            </div>
          ) : (
            <div className="qk-hero-status">
              {anonTrialOffer.show ? (
                <Link href="/premium" style={{ color: '#e8e4dd', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                  Prøv Premium gratis i {anonTrialOffer.days} dager →
                </Link>
              ) : (
                <span style={{ color: '#e8e4dd' }}>Premium kr 49/mnd</span>
              )}
            </div>
          )}
        </section>

        {/* ── Slik fungerer det — tre steg, samme kortstil og klasser som
            «Under quizen» rett under. Står UTENFOR qk-hero med vilje:
            heroen er text-align: center, kortene skal være venstrestilte. ── */}
        <div className="qk-interlude">
          <div className="qk-interlude-cards">
            {([
              { label: 'Steg 1', title: 'Spill quizen', desc: 'Hver fredag kl. 12. Svar raskt — tiden teller.' },
              { label: 'Steg 2', title: 'Se plasseringen', desc: 'Se score og svartid. Med Premium: nøyaktig plassering og full toppliste.' },
              { label: 'Steg 3', title: 'Følg sesongen', desc: 'Kom tilbake neste uke og klatre. Månedslisten starter på nytt hver måned; kvartal, år og all-time bygger seg opp.' },
            ] as const).map(({ label, title, desc }) => (
              <div key={label} className="qk-interlude-card">
                <p className="qk-preview-card-label">{label}</p>
                <p className="qk-interlude-card-title">{title}</p>
                <p className="qk-interlude-card-text">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Interlude teaser ── */}
        <div className="qk-interlude">
          <p className="qk-interlude-eyebrow">Under quizen</p>
          <div className="qk-interlude-cards">
            {([
              {
                title: 'Se plasseringen din live',
                text: 'Mellom hvert spørsmål ser du hvordan du ligger an.',
              },
              {
                title: 'Jag en rival',
                text: 'Systemet finner noen på ditt nivå. Kan du slå dem?',
              },
              {
                title: 'Tilpassede meldinger',
                text: 'Streak, halvtid, innspurt — quizen reagerer på hvordan du spiller.',
              },
            ] as const).map(({ title, text }) => (
              <div key={title} className="qk-interlude-card">
                <p className="qk-interlude-card-title">{title}</p>
                <p className="qk-interlude-card-text">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Visuell forhåndsvisning — fiktivt eksempel, kun for gjester ── */}
        <div className="qk-preview">
          <p className="qk-preview-eyebrow">Eksempel — slik ser sesongen ut</p>
          <div className="qk-preview-cards">
            <div className="qk-preview-card">
              <p className="qk-preview-card-label">Plassering</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#918f8a' }}>18.</span>
                <svg width="16" height="12" viewBox="0 0 16 12" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M1 6H15M15 6L10 1M15 6L10 11" stroke="#e8e4dd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#ffffff' }}>11.</span>
              </div>
              <p className="qk-preview-card-text">Du klatret fra 18. til 11. plass</p>
            </div>

            <div className="qk-preview-card">
              <p className="qk-preview-card-label">Rival</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#2a2d38', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'Libre Baskerville', serif", fontSize: 14, fontWeight: 700, color: '#e8e4dd',
                }}>M</div>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#ffffff' }}>Maria</span>
              </div>
              <p className="qk-preview-card-text">120 poeng foran deg denne sesongen</p>
            </div>

            <div className="qk-preview-card">
              <p className="qk-preview-card-label">Sesongutvikling</p>
              <svg width="100%" height="40" viewBox="0 0 160 40" style={{ display: 'block', margin: '0 auto' }} preserveAspectRatio="xMidYMid meet">
                <polyline points="4,32 42,26 80,20 118,12 156,4" fill="none" stroke="#e8e4dd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="156" cy="4" r="3" fill="#ffffff" />
              </svg>
              <p className="qk-preview-card-text">Poengene bygger seg opp uke for uke</p>
            </div>
          </div>
        </div>

        {/* ── Quiz-kort ── */}
        <div className="qk-narrow-wrap">
        {/* Samme rekkefølge som i den innloggede grenen: feiltilstanden FØRST,
            ellers ender en lesefeil i «Ingen quiz planlagt». */}
        {sharedUnavailable ? (
          <QuizStatusUnavailableCard />
        ) : activeQuiz ? (
          <div className="qk-card">
            <p className="qk-card-eyebrow">Denne uken</p>
            <h2 className="qk-title">{activeQuiz.title}</h2>
            <p className="qk-card-tagline">
              {activeParticipantCount > 0
                ? `${activeParticipantCount} deltakere · Kan du slå dem?`
                : 'Kan du slå dem?'}
            </p>
            {anonMonthlyTop3.length > 0 && (
              <div style={{ margin: '14px 0 2px' }}>
                <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 10 }}>
                  Månedens toppliste
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {anonMonthlyTop3.map((entry, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: '#918f8a', width: 16, flexShrink: 0, fontWeight: 600 }}>{i + 1}.</span>
                      <span style={{ fontSize: 13, color: '#e8e4dd', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {truncateName(entry.displayName)}
                      </span>
                      <span style={{ fontSize: 12, color: '#c9a84c', flexShrink: 0, fontWeight: 600 }}>{entry.totalPoints} p</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="qk-card-actions">
              <a href={`/quiz/${activeQuiz.id}`} className="qk-btn-outline-dark">
                Spill nå
              </a>
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
                <Link href={`/leaderboard/${activeQuiz.id}`} className="qk-card-toplist">
                  Ukens resultater ↗
                </Link>
                <Link href="/quizer" className="qk-card-toplist">
                  Alle quizer →
                </Link>
              </div>
            </div>
          </div>
        ) : upcomingQuiz ? (
          <div className="qk-card">
            <p className="qk-card-eyebrow">Kommende quiz</p>
            <h2 className="qk-title">{upcomingQuiz.title}</h2>
            <p className="qk-card-date">
              Åpner {upcomingQuiz.opens_at ? formatNextQuiz(upcomingQuiz.opens_at) : 'snart'}
            </p>
            {/* /login-lenke = påstand om utlogget bruker — skjules ved ukjent */}
            {!authUnknown && (
              <div className="qk-card-actions">
                <Link href="/login" className="qk-btn-outline-dark">
                  Få påminnelse på e-post →
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="qk-card">
            <p className="qk-card-eyebrow">Ingen quiz planlagt</p>
            <h2 className="qk-title">Fredagsquizen</h2>
            <p style={{ fontSize: 14, color: 'var(--hint)', marginBottom: 20, lineHeight: 1.5 }}>
              Neste fredagsquiz kommer snart. Ny quiz åpner fredag kl. 12 — {formatCountdown(fridayCountdown.daysUntil, fridayCountdown.hoursUntil)}.
            </p>
            {lastQuiz && (
              <div className="qk-card-actions">
                <Link href={`/leaderboard/${lastQuiz.id}`} className="qk-btn-outline-dark">
                  Se topplisten
                </Link>
              </div>
            )}
          </div>
        )}
        </div>

        {/* Ukens fakta — quiz insights, samme innhold som innlogget gren.
            Vises så snart en stengt quiz har nok svar — også fredag mens en
            quiz er åpen (innholdet er da fra forrige stengte quiz). Trygt
            uinnlogget: innlogget GRATIS ser det samme, så uinnlogget får
            aldri mer enn innlogget gratis (N3-prinsippet). */}
        {pageInsights && (
          <div className="qk-narrow-wrap">
          <div style={{
            marginBottom: 8, textAlign: 'center',
            background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16,
            padding: '20px 24px',
          }}>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 10 }}>
              Ukens fakta
            </p>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 6 }}>
              {pageInsights.easiest.correctPct}% svarte riktig på ukens letteste:{' '}
              <span style={{ fontStyle: 'italic' }}>{pageInsights.easiest.questionText}</span>
            </p>
            <p style={{ fontSize: 14, color: '#c9a84c', lineHeight: 1.6 }}>
              Kun {pageInsights.hardest.correctPct}% klarte:{' '}
              <span style={{ fontStyle: 'italic' }}>{pageInsights.hardest.questionText}</span>
            </p>
          </div>
          </div>
        )}

        {/* E-postvarsling — kun for uinnloggede, kun uten aktiv quiz.
            Ved ukjent auth skjules den også: å invitere en (muligens
            innlogget) bruker til besøks-varsling er en utlogget-påstand. */}
        {!user && !activeQuiz && !authUnknown && (
          <div className="qk-narrow-wrap">
          <div id="varsle-meg" style={{
            background: '#21242e',
            border: '1px solid #2a2d38',
            borderRadius: 16,
            padding: '24px 24px',
            marginBottom: 8,
            textAlign: 'center',
          }}>
            <p style={{
              fontFamily: "'Libre Baskerville', serif",
              fontSize: 16,
              fontWeight: 700,
              color: '#ffffff',
              marginBottom: 6,
            }}>
              Få beskjed når neste quiz er klar
            </p>
            <p style={{ fontSize: 13, color: '#918f8a', marginBottom: 18, lineHeight: 1.6 }}>
              Vi sender deg en e-post når neste quiz åpner.
            </p>
            <NotifyForm />
          </div>
          </div>
        )}

        {/* ── Forrige uke — topp 3 ── */}
        {lastQuizTop3.length > 0 && lastQuiz && (
          <div className="qk-narrow-wrap">
          <div style={{
            background: '#21242e',
            border: '1px solid #2a2d38',
            borderRadius: 16,
            padding: '20px 24px',
            marginBottom: 8,
          }}>
            <p style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#918f8a',
              marginBottom: 14,
            }}>Forrige uke — hvem vant?</p>
            <div className="qk-top3-rows qkp-league-top3">
              {lastQuizTop3.map((row, i) => {
                const timeStr = `${(row.total_time_ms / 1000).toFixed(1)}s`
                const totalQ = lastQuizQuestionCount || '?'
                return (
                  <div key={i} className="qk-top3-row">
                    <div className="qk-top3-left">
                      <span style={{ fontSize: 13, color: '#918f8a', width: 18, flexShrink: 0, fontWeight: 600 }}>
                        {i + 1}.
                      </span>
                      {row.nickname?.trim() ? (
                        <span style={{ minWidth: 0 }}>
                          <span className="qk-top3-name" style={{ display: 'block' }}>{truncateName(row.nickname.trim())}</span>
                          <span style={{ display: 'block', fontSize: 12, color: '#918f8a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {truncateName(row.player_name)}
                          </span>
                        </span>
                      ) : (
                        <span className="qk-top3-name">{truncateName(row.player_name)}</span>
                      )}
                    </div>
                    <div className="qk-top3-right">
                      {row.correct_answers}/{totalQ}
                      <span className="qk-top3-time"> · {timeStr}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            <Link href={`/leaderboard/${lastQuiz.id}`} style={{
              fontSize: 13,
              color: '#e8e4dd',
              textDecoration: 'none',
            }}>
              Se full toppliste →
            </Link>
          </div>
          </div>
        )}

        {/* ── Org-kort (kun for bedriftsmedlemmer) ── */}
        <OrgCard />

        {/* ── Grunnleggerhistorie ── */}
        <div className="qk-founder-story">
          <div className="qk-founder-story-inner">
            <p className="qk-founder-story-eyebrow">Laget av en quizmaster</p>
            <h2 className="qk-founder-story-title">Over 20 års erfaring — hvert spørsmål skrives og kvalitetssikres før det havner i quizen.</h2>
            <p className="qk-founder-story-body">
              Quizkanonen er laget av en quizmaster med over 20 års erfaring — digitalt og live, i Norge og Spania. Bygget slik vedkommende selv ville ønsket det.
            </p>
            {founderStats && (
              <div className="qk-founder-story-stats">
                <div>
                  <div className="qk-founder-stat-num">{founderStats.quizzesCompleted}+</div>
                  <div className="qk-founder-stat-label">Quizer gjennomført</div>
                </div>
                <div>
                  <div className="qk-founder-stat-num">{founderStats.activePlayers}+</div>
                  <div className="qk-founder-stat-label">Aktive spillere</div>
                </div>
              </div>
            )}
            <Link href="/om" className="qk-founder-story-link">Les historien →</Link>
          </div>
        </div>

        {/* ── Bedrift ── */}
        <div className="qk-biz">
          <div className="qk-biz-inner">
            <h2 className="qk-biz-title">Bruker dere Quizkanonen på jobben?</h2>
            <p className="qk-biz-desc">Ukentlig fredagsquiz til teamet. Vi lager quizen. Dere spiller.</p>
            <Link href="/bedrift" className="qk-biz-link">Se løsninger for bedrifter →</Link>
          </div>
        </div>

        {/* ── Accordion — slik fungerer det ── */}
        <div className="qk-acc-wrap">
          <AccordionSection />
        </div>

        {/* ── Founders ── (ved ukjent auth: «Aktiver gratis tilgang» er et
            tilbud til utloggede/gratis-brukere — vises ikke når vi ikke vet) */}
        {FOUNDERS_ACTIVE && !authUnknown && (
          <div className="qk-narrow-wrap">
          <div className="qk-founders">
            <p className="qk-founders-eyebrow">Founders Access</p>
            <h2 className="qk-founders-title">Prøv Premium gratis</h2>
            <p className="qk-founders-sub">Ingen kortinfo. Ingen automatisk trekk. Vi minner deg på e-post før perioden utløper.</p>
            {foundersSettingsResult && (
              <p style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#c9a84c',
                marginBottom: 14,
              }}>
                {foundersSettingsResult.remaining} av {foundersSettingsResult.max} plasser igjen
              </p>
            )}
            <Link href="/premium" className="qk-founders-btn">Aktiver gratis tilgang →</Link>
          </div>
          </div>
        )}

      </div>

      <PushNotificationPrompt />
    </>
  )
}
