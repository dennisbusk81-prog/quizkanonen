// Server-only — never import this in 'use client' components.
import { supabaseAdmin } from './supabase-admin'
import { readStoredKey } from './answer-key-correction'
import { onlyRealQuizAttempts, onlyArchiveQuizAttempts } from './real-quiz-population'
import { fetchAllRows, fetchAllRowsChunked } from './paginate'
import {
  averageCorrectByQuiz,
  computeFieldProgress,
  type FieldProgress,
} from './field-relative-progress'
import {
  buildFrozenRanks,
  countPlayersByQuiz,
  pickBestePlassering,
  type BestePlassering,
  type FrozenRank,
  type SeasonRankRow,
} from './frozen-rank'
import {
  computeCategoryStats,
  pickCategoryStrength,
  type CategoryStrength,
} from './category-stats'
import {
  computeParticipationStreak,
  type ParticipationStreak,
  type StreakQuiz,
} from './participation-streak'

// ─── Exported types ──────────────────────────────────────────────────────────

export type HistoryAttempt = {
  id: string
  quiz_id: string
  quiz_title: string
  // Åpent verdirom ('weekly', 'bonus', 'archive', …) — quiz_type er NOT NULL
  // DEFAULT 'weekly' uten CHECK i basen. Feltet er med for at en rad skal
  // kunne bære «Trening»-markøren når den står løsrevet fra seksjonen sin
  // (besluttet 26. august 2026); klienten viser markøren på 'archive'.
  quiz_type: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  correct_streak: number | null
  completed_at: string
  rank: number | null
  total_players: number | null
}

/**
 * Hvilken quiz-populasjon getPlayerHistory skal lese.
 *
 *   'real'    = ekte konkurranse (gulvet i lib/real-quiz-population.ts) —
 *               fredagshistorikken og ALT av statistikk.
 *   'archive' = kun arkivquizer (`quiz_type='archive'`, ikke testflagget) —
 *               egen «Arkiv»-seksjon på /historikk. Arkivforsøk teller ALDRI
 *               i snitt, rekorder, kategoristyrke eller grafen; getPlayerStats
 *               har derfor ingen scope-parameter og er alltid real-only.
 *
 * Merk at et TESTFLAGGET arkivforsøk faller utenfor begge — se
 * onlyArchiveQuizAttempts.
 */
export type HistoryScope = 'real' | 'archive'

export type PlayerStats = {
  total_attempts: number
  total_correct: number
  total_questions: number
  best_streak: number
  avg_score_pct: number
  /**
   * Beste frosne plassering fra `season_scores` i global scope, med hvilken
   * quiz den ble satt på og hvor mange som spilte den.
   *
   * `null` når spilleren ikke har noen global plassering i det hele tatt —
   * f.eks. fordi hen har meldt seg ut av den åpne konkurransen. Da vises
   * ingen plasseringsrad noe sted, hverken her eller på /profil.
   */
  beste_plassering: BestePlassering | null
  /**
   * Ferdig formulert progresjonstekst, målt mot feltet — ikke mot spillerens
   * egen rå score. Se lib/field-relative-progress.ts for hvorfor.
   * `null` ved færre enn to forsøk; utviklingskortet skjules da helt.
   */
  progresjon: FieldProgress | null
  /**
   * Feltets gjennomsnittlige antall RIKTIGE per quiz, for hver quiz spilleren
   * har spilt. Nøkkel er quiz_id.
   *
   * Antall riktige og ikke prosent: grafen regner om med sin egen
   * `total_questions` per rad, som er den eneste nevneren som er sann for
   * nøyaktig den quizen. Lagres prosent her, låses nevneren til det som var
   * sant da snittet ble regnet.
   */
  felt_snitt_riktige: Record<string, number>
  // Sterkeste/svakeste kategori på tvers av ALL brukerens historikk — ikke én
  // quiz. Begge er null når færre enn to kategorier klarer terskelen; se
  // pickCategoryStrength() i lib/category-stats.ts for reglene.
  sterkeste_kategori: string | null
  svakeste_kategori: string | null
  // Andel riktige i de to kategoriene over, i prosent, med råtallene bak.
  // Alle seks er null nøyaktig når kategorien er null — se CategoryStrength i
  // lib/category-stats.ts.
  //
  // NB: dette er andel av BESVARTE spørsmål i kategorien over hele
  // historikken, ikke andel av alle spørsmål i banken i den kategorien.
  //
  // `_riktige`/`_besvart` vises sammen med prosenten fordi terskelen er 3
  // svar: «100 %» er ofte 3 av 3, og prosenten alene overselger det.
  sterkeste_kategori_prosent: number | null
  sterkeste_kategori_riktige: number | null
  sterkeste_kategori_besvart: number | null
  svakeste_kategori_prosent: number | null
  svakeste_kategori_riktige: number | null
  svakeste_kategori_besvart: number | null
  // Fredagsquizer på rad. IKKE det samme som `best_streak` over, som er
  // riktige svar på rad inne i ÉN quiz (attempts.correct_streak). Se
  // lib/participation-streak.ts.
  deltakelsesrekke: number
  lengste_deltakelsesrekke: number
}

export type AttemptAnswerDetail = {
  question_id: string
  question_text: string
  selected_answer: string | null       // letter code: 'A' | 'B' | 'C' | 'D' | null
  selected_answer_text: string | null  // option text, null if no answer given
  is_correct: boolean
  correct_answers: string[]            // letter code(s), one per correct option
  correct_answer_texts: string[]       // option text(s), same order as correct_answers
  time_ms: number
}

export type AttemptDetail = {
  attempt_id: string
  quiz_id: string
  quiz_title: string
  completed_at: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  rank: number | null
  total_players: number | null
  answers: AttemptAnswerDetail[]
  // To RÅ fakta om quizen, ikke ett utledet «kan du klikke videre?». Begge
  // avgjør om /leaderboard/[id] viser noe i det hele tatt, men de gjør det på
  // hver sin måte, og detaljsiden må kunne skille dem hvis teksten senere skal
  // bli mer presis enn «lenken vises ikke».
  //
  //   quiz_is_active = false        → RLS-policyen quizzes_select_active gir
  //                                   null rader til klienten, og
  //                                   /leaderboard/[id] havner i sin
  //                                   fetchError-gren.
  //   quiz_show_leaderboard = false → siden svarer «Resultater er ikke
  //                                   aktivert for denne quizen».
  quiz_is_active: boolean
  quiz_show_leaderboard: boolean
}

export type PlayerHistoryResult = {
  history: HistoryAttempt[]
  stats: PlayerStats
  // Pagination — present when the caller passes page/pageSize
  total?: number
  page?: number
  pageSize?: number
}

/**
 * Svaret fra GET /api/historikk?scope=archive — UTEN stats, med vilje:
 * statistikken er real-only uansett, og å regne den på nytt for
 * arkiv-hentingen ville doblet den tyngste delen av lasten (kategoristyrken
 * paginerer over hele attempt_answers-historikken) uten at klienten kan
 * bruke svaret til noe.
 */
export type ArchiveHistoryResult = {
  history: HistoryAttempt[]
  total: number
  page: number
  pageSize: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

// HER LÅ `computeRanks()`, som regnet rangering LIVE over `attempts` hver gang
// historikken ble lest. Fjernet 13. august 2026. Den hadde to feil:
//
//  1. Den fabrikkerte en plassering for spillere som ikke har noen. 17 av 488
//     forsøk fordelt på 7 brukere, hvorav seks er Elkjøp-ansatte med opt-out —
//     de hadde valgt seg vekk fra den åpne konkurransen og fikk likevel en
//     plassering i den vist på sin egen historikkside.
//  2. Den var upaginert og kuttet stille ved 1000 rader (F3 i
//     .claude/QK_LASTMALING_5AUGUST.md, anslått til å bite ved ~3 quizer per
//     historikkside). Byttet fjerner den risikoen fra lesestien helt.
//
// Plasseringen leses nå fra `season_scores.rank` i global scope — samme
// autoritative, frosne tall topplista viser. Se lib/frozen-rank.ts, som også
// forklarer hvorfor NEVNEREN må komme fra antall forsøk og ikke fra antall
// season_scores-rader.
//
// UOPPGJORTE QUIZER FÅR INGEN PLASSERING, og det er et bevisst valg framfor å
// beholde en «foreløpig» live-beregning: vinduet er timene mellom at man
// leverer og at cronen gjør opp, spilleren har akkurat sett plasseringen sin på
// resultatskjermen, og en rad som viser score og tid uten plassering er sann.
// Å holde liv i en andre rangeringskilde for det vinduet ville gjeninnført
// begge feilene over.

type FieldRow = { quiz_id: string; correct_answers: number }

/**
 * Feltets gjennomsnittlige antall riktige på hver av quizene spilleren har
 * spilt. Ren aggregering ligger i lib/field-relative-progress.ts; denne
 * funksjonen gjør kun uthentingen.
 *
 * POPULASJONEN ER DEN SAMME som resten av getPlayerStats bruker —
 * `correct_streak IS NOT NULL` = fullført forsøk. Bruker man en annen
 * populasjon her enn i tellingen spilleren sammenlignes mot, sammenligner man
 * to ulike ting og kaller det utvikling.
 *
 * `fetchAllRowsChunked` og ikke `fetchAllRows`: spørringen filtrerer på en
 * LISTE med quiz-id-er, og da treffer man ~390-grensen på URL-lengde FØR
 * 1000-radstaket (se lib/paginate.ts). En trofast spiller passerer 390 quizer
 * først etter mange år, men grensen er gratis å dekke når helperen finnes.
 *
 * `.order('id')` er ikke pynt: uten et deterministisk totalorden kan to sider
 * overlappe eller hoppe over rader mellom seg, og et snitt regnet på et
 * resultatsett med hull ser helt normalt ut.
 */
async function fetchFieldStats(
  quizIds: string[]
): Promise<{ snitt: Record<string, number>; deltakere: Record<string, number> }> {
  if (quizIds.length === 0) return { snitt: {}, deltakere: {} }

  const rows = await fetchAllRowsChunked<FieldRow>(quizIds, (chunk, from, to) =>
    supabaseAdmin
      .from('attempts')
      .select('quiz_id, correct_answers')
      .in('quiz_id', chunk)
      .not('correct_streak', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
  )

  // Ett sett rader, to avledninger: snittet mater progresjonsteksten og
  // feltlinja i grafen, antallet er NEVNEREN i «#12 av 63». Antallet MÅ komme
  // herfra og ikke fra season_scores — se lib/frozen-rank.ts.
  return { snitt: averageCorrectByQuiz(rows), deltakere: countPlayersByQuiz(rows) }
}

/**
 * Brukerens frosne plassering per quiz, fra `season_scores` i global scope.
 *
 * `scope_id IS NULL` settes eksplisitt selv om `scope_type = 'global'` allerede
 * innebærer det (bekreftet mot prod: 0 av 471 globale rader har scope_id, og 0
 * av de ikke-globale mangler den). Filteret koster ingenting og gjør
 * invarianten synlig på stedet.
 */
async function fetchFrozenRanks(
  userId: string,
  quizIds: string[],
  deltakere: Record<string, number>
): Promise<Record<string, FrozenRank>> {
  if (quizIds.length === 0) return {}

  const rows = await fetchAllRowsChunked<SeasonRankRow>(quizIds, (chunk, from, to) =>
    supabaseAdmin
      .from('season_scores')
      .select('user_id, quiz_id, rank')
      .eq('scope_type', 'global')
      .is('scope_id', null)
      .eq('user_id', userId)
      .in('quiz_id', chunk)
      .order('quiz_id', { ascending: true })
      .range(from, to)
  )

  return buildFrozenRanks(rows, deltakere, userId)
}

function resolveTitle(raw: unknown): string {
  const v = raw as { title: string } | { title: string }[] | null
  if (Array.isArray(v)) return v[0]?.title ?? 'Ukjent quiz'
  return v?.title ?? 'Ukjent quiz'
}

// Samme form-forsvar som resolveTitle. Fallbacken er tom streng, ikke
// 'weekly': en ulesbar embed skal gi «ingen markør», aldri en påstand om at
// forsøket var en fredagsquiz.
function resolveQuizType(raw: unknown): string {
  const v = raw as { quiz_type?: unknown } | { quiz_type?: unknown }[] | null
  const row = Array.isArray(v) ? v[0] : v
  return typeof row?.quiz_type === 'string' ? row.quiz_type : ''
}

// Samme forsvar som resolveTitle: PostgREST returnerer en embed som objekt
// eller som array avhengig av relasjonens form, og å anta feil form gir null
// uten feilmelding. Målt mot prod 2. august 2026 er denne et objekt — men
// antakelsen står ikke alene her.
// Samme form-forsvar som resolveTitle/resolveCategory, for de booleanske
// quiz-flaggene. Standardverdien ved ulesbar embed er `true`, altså «vis
// lenken» — bevisst motsatt av fail-safen i /api/leaderboard/[id], og av en
// grunn: der holdes ANDRE spilleres rader tilbake, og en blipp skal ikke kunne
// åpne en skjult stilling. Her er utfallet en navigasjonslenke uten
// sikkerhetsdimensjon, og flaggene leses i SAMME .single() som selve forsøket
// — er de ulesbare, lastet ikke forsøket heller. «Ulesbar» betyr derfor en
// form-overraskelse, ikke en forbigående feil, og å falle lukket ville stille
// fjernet en lenke som virker.
function resolveQuizFlag(raw: unknown, key: 'is_active' | 'show_leaderboard'): boolean {
  const v = raw as Record<string, unknown> | Record<string, unknown>[] | null
  const row = Array.isArray(v) ? v[0] : v
  const flag = row?.[key]
  return typeof flag === 'boolean' ? flag : true
}

function resolveCategory(raw: unknown): string | null {
  const v = raw as { category: string | null } | { category: string | null }[] | null
  if (Array.isArray(v)) return v[0]?.category ?? null
  return v?.category ?? null
}

type CategoryAnswerRow = {
  question_id: string
  is_correct: boolean
  questions: unknown
}

/**
 * Sterkeste/svakeste kategori over ALLE brukerens forsøk.
 *
 * Populasjonen er nøyaktig den samme som resten av getPlayerStats bruker:
 * `attempts.correct_streak IS NOT NULL` = fullført forsøk. Filteret settes på
 * den embeddede attempts-raden (`attempts!inner`), slik at én spørring gjør
 * både avgrensningen og hentingen — ingen `.in()` med en voksende liste av
 * attempt-id-er, og dermed heller ingen berøring med ~390-id-grensen i
 * lib/paginate.ts.
 *
 * `questions(category)` er bevisst en VANLIG embed, ikke `!inner`: et svar på
 * et spørsmål uten kategori skal fortsatt telles (det havner i
 * «Uten kategori»-bøtta og holder summen hel), ikke forsvinne fra grunnlaget.
 *
 * PAGINERING ER IKKE VALGFRI HER. En bruker samler ~20 svarrader per quiz, så
 * en trofast spiller passerer 1000-taket i løpet av omtrent ett år med
 * ukentlig quiz. PostgREST kutter da stille, og nettopp de mest lojale
 * brukerne ville fått kategoritall regnet på en vilkårlig del av historikken
 * sin — uten at noe så galt ut. Se category-strength.pagination.test.ts.
 */
async function fetchCategoryStrength(userId: string): Promise<CategoryStrength> {
  // Populasjonen skal være arkiv-fri som resten av getPlayerStats, men denne
  // spørringen går IKKE via quizIds — den leser attempt_answers direkte, og
  // trenger derfor sitt eget filter. Stien er nestet: `attempts.quizzes.…`,
  // ikke `quizzes.…`, derav path-argumentet, og quiz-embeden må ligge INNE i
  // attempts-embeden. Den nestede filterformen ble målt mot prod 25. august
  // 2026 og binder.
  const rows = await fetchAllRows<CategoryAnswerRow>((from, to) => {
    const base = supabaseAdmin
      .from('attempt_answers')
      .select('question_id, is_correct, attempts!inner(user_id, correct_streak, quizzes!inner(id)), questions(category)')
      .eq('attempts.user_id', userId)
      .not('attempts.correct_streak', 'is', null)
    return onlyRealQuizAttempts(base, 'attempts.quizzes')
      .order('id', { ascending: true })
      .range(from, to)
  })

  const answers = rows.map((r) => ({ questionId: r.question_id, isCorrect: r.is_correct }))

  // computeCategoryStats slår opp kategori via questionId → question.id, så
  // hvert spørsmål skal være med ÉN gang uansett hvor mange ganger det er
  // besvart (samme spørsmål kan gå igjen i flere quizer).
  const questions = [
    ...new Map(
      rows.map((r) => [r.question_id, { id: r.question_id, category: resolveCategory(r.questions) }])
    ).values(),
  ]

  return pickCategoryStrength(computeCategoryStats(answers, questions))
}

type StreakQuizRow = { id: string; season_points_awarded: boolean | null }

/**
 * Deltakelsesrekke — hvor mange fredagsquizer på rad brukeren har spilt.
 * Ren logikk og begrunnelse ligger i lib/participation-streak.ts; denne
 * funksjonen gjør kun uthentingen.
 *
 * POPULASJONEN er gjenbruk, ikke en ny definisjon: `is_test = false` +
 * `season_points_awarded` er nøyaktig markørene `fetchRetentionRows()` i
 * lib/retention.ts bruker for «faktisk spilt og gjort opp». Forskjellen er
 * `.lte('opens_at', now)` i stedet for `.eq('season_points_awarded', true)`:
 * kveldens ÅPNE quiz må være med i lista for at en spiller som nettopp har
 * levert skal se rekken telle opp med én gang, og flagget følger med som
 * `settled` slik at den rene funksjonen kan behandle den asymmetrisk.
 * Planlagte quizer (opens_at fram i tid — 6 stykker i prod per 2. august)
 * holdes ute her, ikke i logikken.
 *
 * `quiz_type = 'weekly'` er ETT filter til, som retention IKKE har, og det er
 * bevisst: rekken lover «fredagsquizer på rad», og en bonusquiz er ikke en
 * fredagsquiz. Uten filteret ville en bonusquiz som ble gjort opp brutt rekken
 * til alle som spiller trofast hver fredag, uten at de hadde gjort noe galt.
 * `'weekly'` er samme markør /api/toppliste og /api/org/[slug]/quiz-scores
 * allerede bruker for å skille ut fredagsserien. (Per 2. august er alle 13
 * quizene i prod `weekly`, så filteret endrer ingenting i dag — det er
 * forsikring mot den første bonusquizen.)
 *
 * DELTAKELSE måles på `submitted_at`, IKKE på `correct_streak IS NOT NULL`
 * som resten av getPlayerStats bruker til å avgrense «fullført forsøk».
 * Avviket er bevisst og målt: i prod 2. august 2026 finnes 6 rader med
 * `correct_streak = 0` og `submitted_at = NULL` — alle med 0 riktige, 0 ms og
 * 15 spørsmål, altså forsøk som ble påbegynt og forlatt. De endrer svaret for
 * 6 av 130 spillere, og i ett tilfelle fabrikkerer de en hel rekke: en bruker
 * som aldri svarte på quizen 19.06 ville fått «7 på rad» i stedet for 6.
 * Å ha startet en quiz er ikke å ha deltatt i den.
 *
 * PAGINERING PÅ BEGGE: quizzes vokser med én rad i uka og attempts med én per
 * spiller per quiz, så begge passerer 1000-taket med tiden — og et `.limit()`
 * i nærheten er ikke bevis på noe, databasen har db-max-rows = 1000 og gir
 * 1000 rader uansett hva man ber om. Sekundærsorteringen på `id` er ikke
 * pynt: uten et deterministisk totalorden kan to sider med likt `opens_at`
 * overlappe eller hoppe over rader mellom seg.
 */
async function fetchParticipationStreak(userId: string): Promise<ParticipationStreak> {
  const nowIso = new Date().toISOString()

  const [quizRows, attemptRows] = await Promise.all([
    fetchAllRows<StreakQuizRow>((from, to) =>
      supabaseAdmin
        .from('quizzes')
        .select('id, season_points_awarded')
        .eq('is_test', false)
        .eq('quiz_type', 'weekly')
        .not('opens_at', 'is', null)
        .lte('opens_at', nowIso)
        .order('opens_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<{ quiz_id: string }>((from, to) =>
      supabaseAdmin
        .from('attempts')
        .select('quiz_id')
        .eq('user_id', userId)
        .not('submitted_at', 'is', null)
        .order('quiz_id', { ascending: true })
        .range(from, to)
    ),
  ])

  const quizzes: StreakQuiz[] = quizRows.map((q) => ({
    id: q.id,
    settled: q.season_points_awarded === true,
  }))

  return computeParticipationStreak(quizzes, attemptRows.map((a) => a.quiz_id))
}

type QuestionRow = {
  id: string
  question_text: string
  correct_answer: string
  correct_answers: string[] | null
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
}

function getOptionText(q: QuestionRow, letter: string | null): string | null {
  if (!letter) return null
  const opts: Record<string, string | null | undefined> = {
    A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d,
  }
  return opts[letter.toUpperCase()] ?? letter
}

// ─── Public functions ─────────────────────────────────────────────────────────

export async function getPlayerHistory(
  userId: string,
  opts: { page?: number; pageSize?: number; scope?: HistoryScope } = {}
): Promise<{ items: HistoryAttempt[]; total: number }> {
  const pageSize = opts.pageSize ?? 50
  const page     = opts.page     ?? 0
  const scope    = opts.scope    ?? 'real'
  const from     = page * pageSize
  const to       = from + pageSize - 1

  // Populasjonsfilteret må på BEGGE spørringene — data OG count. Count-en
  // brukte tidligere `select('*')`; embeden MÅ stå i select-listen for at
  // quizzes-filteret skal virke der også, ellers teller totalen forsøk lista
  // aldri viser og total/hasMore-regnestykket i klienten brekker. `!inner`
  // gjør joinen til et filter; uten embed svarer PostgREST 400 PGRST108
  // (høylytt, som er riktig retning å feile i).
  //
  // Lokale variabler før helper-kallet, ikke inlinet — TS2589-regelen fra
  // lib/real-quiz-population.ts.
  const dataBase = supabaseAdmin
    .from('attempts')
    .select(
      'id, quiz_id, correct_answers, total_questions, total_time_ms, correct_streak, completed_at, quizzes!inner(title, quiz_type)'
    )
    .eq('user_id', userId)
    .not('correct_streak', 'is', null)
  const countBase = supabaseAdmin
    .from('attempts')
    .select('quizzes!inner(id)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('correct_streak', 'is', null)

  const dataQuery = scope === 'archive'
    ? onlyArchiveQuizAttempts(dataBase)
    : onlyRealQuizAttempts(dataBase)
  const countQuery = scope === 'archive'
    ? onlyArchiveQuizAttempts(countBase)
    : onlyRealQuizAttempts(countBase)

  const [{ data, error }, { count }] = await Promise.all([
    dataQuery.order('completed_at', { ascending: false }).range(from, to),
    countQuery,
  ])

  if (error || !data) return { items: [], total: 0 }

  // Frossen plassering fra season_scores. Feltstørrelsen hentes fra forsøkene
  // i samme slengen — den kan IKKE telles fra season_scores-rader, se
  // lib/frozen-rank.ts.
  const quizIds = [...new Set(data.map((r) => r.quiz_id))]
  const { deltakere } = await fetchFieldStats(quizIds)
  const frosne = await fetchFrozenRanks(userId, quizIds, deltakere)

  const items = data.map((row) => {
    const f = frosne[row.quiz_id]
    return {
      id: row.id,
      quiz_id: row.quiz_id,
      quiz_title: resolveTitle(row.quizzes),
      quiz_type: resolveQuizType(row.quizzes),
      correct_answers: row.correct_answers,
      total_questions: row.total_questions,
      total_time_ms: row.total_time_ms,
      correct_streak: row.correct_streak ?? null,
      completed_at: row.completed_at,
      rank: f?.rank ?? null,
      total_players: f?.total_players ?? null,
    }
  })

  return { items, total: count ?? 0 }
}

export async function getPlayerStats(userId: string): Promise<PlayerStats> {
  const EMPTY: PlayerStats = {
    total_attempts: 0,
    total_correct: 0,
    total_questions: 0,
    best_streak: 0,
    avg_score_pct: 0,
    beste_plassering: null,
    progresjon: null,
    felt_snitt_riktige: {},
    sterkeste_kategori: null,
    svakeste_kategori: null,
    sterkeste_kategori_prosent: null,
    sterkeste_kategori_riktige: null,
    sterkeste_kategori_besvart: null,
    svakeste_kategori_prosent: null,
    svakeste_kategori_riktige: null,
    svakeste_kategori_besvart: null,
    deltakelsesrekke: 0,
    lengste_deltakelsesrekke: 0,
  }

  // HER LÅ EN 90-DAGERS SPØRRING over ALLE brukeres forsøk, som matet
  // persentilene «Bedre enn andre» og «Raskere enn andre». Begge er fjernet
  // fra siden (se app/historikk/page.tsx), og spørringen med dem: den var
  // upaginert og kuttet stille ved 1000 rader, altså allerede feil, og den
  // leste hele tabellen for å svare på noe siden ikke lenger spør om.
  // Statistikken er ALLTID real-only (besluttet 25.–26. august 2026):
  // arkivforsøk skal ikke telle i snitt, rekorder, kategoristyrke,
  // feltsnittgrafen eller «Din siste quiz». Filteret ligger på DENNE ene
  // spørringen fordi `quizIds` under er inngangen til alt nedstrøms —
  // feltsnitt, frosne plasseringer, beste plassering og progresjon blir
  // arkiv-frie transitivt. De to unntakene som IKKE går via quizIds:
  // kategoristyrken har sitt eget nestede filter (se fetchCategoryStrength),
  // og deltakelsesrekken var allerede gatet på `quiz_type='weekly'`.
  const statsBase = supabaseAdmin
    .from('attempts')
    .select(
      'id, quiz_id, correct_answers, total_questions, total_time_ms, correct_streak, completed_at, quizzes!inner(title)'
    )
    .eq('user_id', userId)
    .not('correct_streak', 'is', null)
  const statsQuery = onlyRealQuizAttempts(statsBase)
  const { data: userAttempts } = await statsQuery

  if (!userAttempts || userAttempts.length === 0) return EMPTY

  // Tittelen følger med den spørringen som uansett kjører — «Beste plassering»
  // skal vise hvilken quiz den ble satt på, og et eget oppslag for det ville
  // vært en rundtur til ingen nytte.
  const quizTitleById = new Map<string, string>(
    userAttempts.map((a) => [a.quiz_id, resolveTitle(a.quizzes)])
  )

  // Core aggregates
  const total_attempts = userAttempts.length
  const total_correct = userAttempts.reduce((sum, r) => sum + (r.correct_answers ?? 0), 0)
  const total_questions = userAttempts.reduce((sum, r) => sum + (r.total_questions ?? 0), 0)
  const best_streak = Math.max(0, ...userAttempts.map((r) => r.correct_streak ?? 0))
  const avg_score_pct = pct(total_correct, total_questions)

  // Ranks — one extra query to fetch all-quiz attempts.
  // Kategoristyrken er uavhengig av rangeringen og hentes i samme bølge, slik
  // at den ikke koster en ekstra seriell rundtur. Den ligger her og ikke i
  // første Promise.all fordi den da ville blitt betalt også for brukere som
  // returnerer EMPTY over.
  const quizIds = [...new Set(userAttempts.map((a) => a.quiz_id))]

  const [categoryStrength, participation, feltStats] = await Promise.all([
    fetchCategoryStrength(userId),
    fetchParticipationStreak(userId),
    fetchFieldStats(quizIds),
  ])
  const felt_snitt_riktige = feltStats.snitt

  // Beste plassering leses fra season_scores, ikke fra en live-beregning. Den
  // vises på /historikk (Rekorder-kortet) OG i statistikkraden på /profil — to
  // flater, samme kilde. En spiller som har meldt seg ut av den åpne
  // konkurransen får null her, som er det riktige svaret for noen som ikke
  // deltar i den.
  const frosne = await fetchFrozenRanks(userId, quizIds, feltStats.deltakere)
  const beste_plassering = pickBestePlassering(
    userAttempts.map((a) => ({
      quiz_id: a.quiz_id,
      quiz_title: quizTitleById.get(a.quiz_id) ?? 'Ukjent quiz',
      completed_at: a.completed_at,
    })),
    frosne
  )

  // Progresjon målt mot FELTET, ikke mot spillerens egen rå score. En quiz kan
  // være vanskelig for alle — feltets snitt svinger fra 6,43 til 10,32 riktige
  // av 15 mellom uker i prod — og den gamle beregningen tilskrev hele den
  // svingningen spilleren.
  //
  // Forsøk på quizer uten feltsnitt hoppes over framfor å regnes mot 0: et
  // manglende snitt ville ellers gitt en diff på spillerens fulle score, som
  // ser ut som en voldsom framgang.
  const progresjon = computeFieldProgress(
    userAttempts
      .filter((a) => felt_snitt_riktige[a.quiz_id] !== undefined)
      .map((a) => ({
        correct: a.correct_answers,
        fieldAvgCorrect: felt_snitt_riktige[a.quiz_id],
        completedAt: a.completed_at,
      })),
    Date.now()
  )

  return {
    total_attempts,
    total_correct,
    total_questions,
    best_streak,
    avg_score_pct,
    beste_plassering,
    progresjon,
    felt_snitt_riktige,
    sterkeste_kategori: categoryStrength.sterkeste,
    svakeste_kategori: categoryStrength.svakeste,
    sterkeste_kategori_prosent: categoryStrength.sterkesteProsent,
    sterkeste_kategori_riktige: categoryStrength.sterkesteRiktige,
    sterkeste_kategori_besvart: categoryStrength.sterkesteBesvart,
    svakeste_kategori_prosent: categoryStrength.svakesteProsent,
    svakeste_kategori_riktige: categoryStrength.svakesteRiktige,
    svakeste_kategori_besvart: categoryStrength.svakesteBesvart,
    deltakelsesrekke: participation.current,
    lengste_deltakelsesrekke: participation.longest,
  }
}

/**
 * Returns full details for a single attempt, including per-question answers.
 * Returns null if the attempt does not exist or does not belong to userId.
 */
export async function getAttemptDetail(
  attemptId: string,
  userId: string
): Promise<AttemptDetail | null> {
  // Fetch attempt — the .eq('user_id', userId) doubles as ownership verification
  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from('attempts')
    .select(
      'id, quiz_id, correct_answers, total_questions, total_time_ms, completed_at, quizzes(title, is_active, show_leaderboard)'
    )
    .eq('id', attemptId)
    .eq('user_id', userId)
    .single()

  if (attemptError || !attempt) {
    return null
  }

  // Fetch attempt_answers and questions for this quiz in parallel
  const [{ data: answers }, { data: questions }] = await Promise.all([
    supabaseAdmin
      .from('attempt_answers')
      .select('question_id, selected_answer, is_correct, time_ms')
      .eq('attempt_id', attemptId),
    supabaseAdmin
      .from('questions')
      .select('id, question_text, correct_answer, correct_answers, option_a, option_b, option_c, option_d')
      .eq('quiz_id', attempt.quiz_id),
  ])

  // Build a lookup map for questions
  const questionMap = new Map<string, QuestionRow>()
  for (const q of questions ?? []) {
    questionMap.set(q.id, q as QuestionRow)
  }

  // Frossen plassering — SAMME kilde som lista på /historikk. De to flatene
  // viser samme tall om samme forsøk, og måtte derfor bytte kilde i samme
  // operasjon: en bruker som ser «ingen plassering» i lista og «#71 av 71» når
  // hen klikker seg inn, ville hatt god grunn til å tro at én av dem lyver.
  const { deltakere } = await fetchFieldStats([attempt.quiz_id])
  const frosne = await fetchFrozenRanks(userId, [attempt.quiz_id], deltakere)
  const rank = frosne[attempt.quiz_id]

  const mappedAnswers: AttemptAnswerDetail[] = (answers ?? []).map((a) => {
    const q = questionMap.get(a.question_id) ?? null
    const selectedLetter = (a.selected_answer as string | null) ?? null
    // readStoredKey() er samme fallback som scoringen i submit/route.ts og
    // spillskjermen i app/quiz/[id]/page.tsx bruker: correct_answers[] vinner
    // når den har innhold, ellers faller den tilbake på enkelt-kolonnen.
    const correctLetters = q ? readStoredKey(q) : []
    return {
      question_id: a.question_id,
      question_text: q?.question_text ?? '',
      selected_answer: selectedLetter,
      selected_answer_text: q ? getOptionText(q, selectedLetter) : null,
      is_correct: a.is_correct as boolean,
      correct_answers: correctLetters,
      correct_answer_texts: correctLetters.map((l) => (q ? getOptionText(q, l) ?? l : l)),
      time_ms: a.time_ms as number,
    }
  })

  return {
    attempt_id: attempt.id,
    quiz_id: attempt.quiz_id,
    quiz_title: resolveTitle(attempt.quizzes),
    completed_at: attempt.completed_at,
    correct_answers: attempt.correct_answers,
    total_questions: attempt.total_questions,
    total_time_ms: attempt.total_time_ms,
    rank: rank?.rank ?? null,
    total_players: rank?.total_players ?? null,
    answers: mappedAnswers,
    quiz_is_active: resolveQuizFlag(attempt.quizzes, 'is_active'),
    quiz_show_leaderboard: resolveQuizFlag(attempt.quizzes, 'show_leaderboard'),
  }
}
