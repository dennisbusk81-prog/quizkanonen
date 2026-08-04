import { supabaseAdmin } from './supabase-admin'
import { fetchAllRows } from './paginate'
import {
  deriveBlockedFromScores,
  deriveBlockedFromLiveStatus,
  type OrgMembership,
} from './global-league-visibility'

// ── Hvem skal IKKE vises på de OFFENTLIGE resultatflatene for en quiz? ───────
// Delt av /api/toppliste (global «Siste quiz»-fane), /api/leaderboard/[id]
// (den enkelte quizens resultatliste) og prev-rank. Flyttet hit fra
// toppliste-ruten 4. august 2026 da leaderboard-rutene fikk samme gating —
// før det var enkeltquizens liste synlig for alle selv når bedriften hadde
// valgt «hold resultatene internt».
//
// HISTORIKKEN STÅR SOM DEN VAR. Periodevisningene (måned/kvartal/år/all-time)
// leser season_scores og filtrerer aldri på dagens opt-out-status — en bruker
// som meldte seg ut ETTER en quiz beholder plasseringen sin i den quizen.
//
// Kilden til «som det var» finnes allerede: award-season-points skriver KUN
// global-rader for brukere som ikke var blokkert på skrivetidspunktet
// (lib/award-season-points.ts — `.filter(({ userId }) => !globallyBlockedUserIds.has(userId))`).
// For en ferdigbehandlet quiz er derfor «har attempt, men ingen global
// season_scores-rad» nøyaktig lik «var blokkert da quizen ble gjort opp».
// Begge sidene starter fra samme attempts-populasjon (is_team=false,
// user_id not null) — award filtrerer ikke på submitted_at, så et ulevert
// forsøk kan ikke gi et falskt «blokkert».
//
// Er quizen IKKE gjort opp ennå (season_points_awarded=false — den er fortsatt
// åpen, eller cronen har ikke rukket den), finnes ingen historisk fasit. Da er
// dagens status per definisjon også datidens, og vi faller tilbake til det
// live oppslaget (organization_members + organizations). Ingen tilbakevirkende
// kraft er mulig i det vinduet.
//
// MERK: settet er utledet fra SOLO-populasjonen (award/season_scores gjelder
// is_team=false). Bruk det ikke til å filtrere lag-rommet — en lagleder uten
// solo-forsøk ville da feilaktig regnes som blokkert på en gjort-opp quiz.
//
// FEIL ER ÅPENT, IKKE STENGT: klarer vi ikke lese fasiten, returneres et tomt
// sett (ingen blokkering) i stedet for å skjule spillere på feil grunnlag —
// og feilsvaret caches ikke.

// Modul-lokal cache per serverless-instans (samme mønster/TTL som
// last_quiz-attempts-cachen i toppliste-ruten — se kommentaren der om hvorfor
// revalidateTag ikke er et alternativ og opptil 30 s utdatert visning er
// bevisst akseptert). Nøkkel = quiz-id, ikke bruker-settet — kallerne utleder
// attemptUserIds fra data som selv er 30s-cachet/stabil innenfor vinduet.
const BLOCKED_SET_CACHE_TTL_MS = 30_000
const globallyBlockedSetCache = new Map<string, { ids: Set<string>; expires: number }>()

export async function getGloballyBlockedSet(
  quizId: string,
  attemptUserIds: string[],
  seasonPointsAwarded: boolean
): Promise<Set<string>> {
  const now = Date.now()
  const cached = globallyBlockedSetCache.get(quizId)
  if (cached && cached.expires > now) return cached.ids

  const blocked = new Set<string>()

  if (seasonPointsAwarded) {
    // Historisk fasit: hvem fikk faktisk en global-rad for denne quizen.
    // Paginert — season_scores kan passere 1000 rader for én quiz, og
    // PostgREST kutter da stille (se lib/paginate.ts). Filtrerer på quiz_id
    // framfor .in('user_id', …) slik at URL-lengdegrensen ved ~390 id-er
    // aldri blir relevant.
    let scored: { user_id: string }[]
    try {
      scored = await fetchAllRows<{ user_id: string }>((from, to) =>
        supabaseAdmin
          .from('season_scores')
          .select('user_id')
          .eq('quiz_id', quizId)
          .eq('scope_type', 'global')
          .is('scope_id', null)
          .order('user_id', { ascending: true })
          .range(from, to)
      )
    } catch {
      // Cach ikke ved feil — returner tomt (ingen blokkering) framfor å
      // skjule spillere på feil grunnlag i 30 sekunder.
      return blocked
    }
    for (const uid of deriveBlockedFromScores(attemptUserIds, scored.map(r => r.user_id))) {
      blocked.add(uid)
    }
  } else if (attemptUserIds.length > 0) {
    // Quizen er ikke gjort opp ennå — dagens status ER datidens status.
    const { data: orgMems } = await supabaseAdmin
      .from('organization_members')
      .select('user_id, organization_id, global_league_opt_out')
      .in('user_id', attemptUserIds)
    if (orgMems && orgMems.length > 0) {
      const mems = orgMems as OrgMembership[]
      const orgIds = [...new Set(mems.map(m => m.organization_id))]
      const { data: restrictedOrgs } = await supabaseAdmin
        .from('organizations')
        .select('id')
        .in('id', orgIds)
        .eq('allow_global_league', false)
      const restrictedOrgIds = new Set(((restrictedOrgs ?? []) as { id: string }[]).map(o => o.id))
      for (const uid of deriveBlockedFromLiveStatus(mems, restrictedOrgIds)) {
        blocked.add(uid)
      }
    }
  }

  if (globallyBlockedSetCache.size > 50) {
    for (const [k, v] of globallyBlockedSetCache) if (v.expires <= now) globallyBlockedSetCache.delete(k)
  }
  globallyBlockedSetCache.set(quizId, { ids: blocked, expires: now + BLOCKED_SET_CACHE_TTL_MS })
  return blocked
}
