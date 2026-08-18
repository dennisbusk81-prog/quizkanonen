import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'

// Retention-beregningen, delt av /api/admin/retention (tabellen på
// /admin/retention) og /api/admin/dashboard (kortet + grafen).
//
// Ligger her framfor å bli reimplementert som en SQL-RPC nettopp fordi to
// implementasjoner av samme tall uunngåelig drifter fra hverandre. Dashboardet
// og retention-siden SKAL alltid vise identiske prosenter.
//
// DEFINISJON (uendret fra 20. juli-kartleggingen): retention for en quiz er
// hvor stor andel av FORRIGE quiz sine spillere som kom tilbake på denne.
// Nevneren er forrige quiz sitt spillertall — ikke denne quizens. Med denne
// quizens tall som nevner ville man målt «andel av dagens spillere som er
// tilbakevendende», som er noe helt annet.
//
// Kun innloggede (user_id NOT NULL) og fullførte (submitted_at NOT NULL)
// forsøk teller.

export type RetentionQuiz = {
  id: string
  title: string
  opens_at: string | null
  closes_at: string | null
}

export type RetentionAttempt = {
  quiz_id: string
  user_id: string
}

export type RetentionRow = {
  quizId: string
  title: string
  opensAt: string | null
  closesAt: string | null
  players: number
  returned: number | null
  retentionPct: number | null
}

/**
 * Ren beregning. `quizzes` MÅ være sortert stigende på opens_at — rekkefølgen
 * er hele grunnlaget for hva «forrige quiz» betyr.
 *
 * Returnerer nyeste først.
 */
export function computeRetention(
  quizzes: RetentionQuiz[],
  attempts: RetentionAttempt[],
): RetentionRow[] {
  // quiz_id → sett av unike user_id som fullførte.
  const playersByQuiz = new Map<string, Set<string>>()
  for (const a of attempts) {
    if (!a.quiz_id || !a.user_id) continue
    let set = playersByQuiz.get(a.quiz_id)
    if (!set) { set = new Set(); playersByQuiz.set(a.quiz_id, set) }
    set.add(a.user_id)
  }

  const rows: RetentionRow[] = quizzes.map((quiz, i) => {
    const players = playersByQuiz.get(quiz.id) ?? new Set<string>()

    // Retention vises på DENNE quizens rad, men måles bakover mot FORRIGE quiz
    // (kronologisk før). Første quiz har ingen forgjenger og får derfor null,
    // ikke 0 — «ingen målt verdi» er ikke det samme som «ingen kom tilbake».
    const prev = quizzes[i - 1]
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
      closesAt: quiz.closes_at,
      players: players.size,
      returned,
      retentionPct,
    }
  })

  // Nyeste øverst.
  rows.reverse()
  return rows
}

/** Henter grunnlaget og beregner. Nyeste først. */
export async function fetchRetentionRows(): Promise<RetentionRow[]> {
  // season_points_awarded=true er den autoritative «faktisk spilt og gjort
  // opp»-markøren (satt av award-season-points, se lib/award-season-points.ts)
  // — IKKE en closes_at-datosammenligning. Dennis planlegger quizer flere uker
  // fram, så en ren dato-sjekk ville tatt med alle de kommende, uspilte
  // radene. season_points_awarded unngår også testquiz-fallgruven: is_test
  // filtreres i tillegg, samme prinsipp som app/quizer/page.tsx.
  const { data: quizzes, error: quizErr } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, opens_at, closes_at')
    .not('opens_at', 'is', null)
    .eq('season_points_awarded', true)
    .eq('is_test', false)
    .order('opens_at', { ascending: true })

  if (quizErr) throw new Error(quizErr.message)

  // Denne listen vokser monotont over hele historikken (nullstilles aldri) og
  // passerte PostgREST sin stille 1000-rads-grense innen rekkevidde — derfor
  // paginert full henting i stedet for ett enkelt .select().
  const attempts = await fetchAllRows<RetentionAttempt>((from, to) =>
    supabaseAdmin
      .from('attempts')
      .select('quiz_id, user_id')
      .not('user_id', 'is', null)
      .not('submitted_at', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
  )

  return computeRetention(quizzes ?? [], attempts)
}

/**
 * Retention for nyeste STENGTE quiz — tallet dashboard-kortet viser.
 *
 * Filtrerer bort planlagte og pågående quizer: en quiz som åpner i morgen har
 * null spillere ennå og ville gitt 0 % på kortet, som ser ut som et krasj i
 * oppslutningen framfor «ikke spilt ennå».
 */
export function latestClosedRetention(rows: RetentionRow[], now = new Date()): RetentionRow | null {
  return rows.find(r => r.closesAt !== null && new Date(r.closesAt) <= now && r.retentionPct !== null) ?? null
}
