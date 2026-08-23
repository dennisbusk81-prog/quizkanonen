import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'

export type MonthlyStandingRow = { userId: string; displayName: string; totalPoints: number }

// Embedden types `unknown` og smalnes ved lesing (samme mønster som
// CategoryAnswerRow i lib/history.ts): supabase-js uten generert skjema
// infererer embeds som array, men denne many-to-one-relasjonen er ETT objekt
// i praksis (verifisert empirisk mot prod 25. juli, se my-orgs-ruten).
type RawSeasonRow = { user_id: string; points: number; profiles: unknown }

// Månedens globale toppliste, aggregert per bruker — flaten forsidens topp 3
// og «din plassering» (og dermed premium-løftet «nøyaktig plassering») hviler
// på. Paginert (23. august 2026): spørringen var rå og PostgREST kutter stille
// ved 1000 rader. Målt mot prod samme dag: juni 126, juli 279, august-så-langt
// 189 rader — under taket i dag, men veksten er reell og et brudd ville vært
// usynlig (feil topp 3, cachet i 60 s, ingen feilmelding).
//
// Kaster ved lesefeil — kalleren (forsiden) avgjør degraderingen. En feil skal
// ikke se ut som en tom måned (samme prinsipp som lib/has-settled-plays.ts).
//
// Behold rader med tomt/null navn som '—' slik at innlogget rang er identisk
// med tidligere; anon-visning filtrerer '—' bort før topp 3.
export async function getMonthlyGlobalStandings(
  monthStart: string,
  monthEnd: string,
): Promise<MonthlyStandingRow[]> {
  const rows = await fetchAllRows<RawSeasonRow>((from, to) =>
    supabaseAdmin
      .from('season_scores')
      .select('user_id, points, profiles(display_name)')
      .eq('scope_type', 'global')
      .is('scope_id', null)
      .gte('closes_at', monthStart)
      .lt('closes_at', monthEnd)
      .order('id')
      .range(from, to)
  )

  const byUser = new Map<string, MonthlyStandingRow>()
  for (const row of rows) {
    const name = (row.profiles as { display_name: string | null } | null)?.display_name ?? '—'
    const existing = byUser.get(row.user_id)
    if (existing) existing.totalPoints += row.points
    else byUser.set(row.user_id, { userId: row.user_id, displayName: name, totalPoints: row.points })
  }
  return [...byUser.values()].sort((a, b) => b.totalPoints - a.totalPoints)
}
