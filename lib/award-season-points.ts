// Delt logikk for tildeling av sesongpoeng — brukes av:
//   - /api/cron/award-season-points  (poller hvert 30. minutt)
//   - /api/cron/publish-quiz         (kaller umiddelbart når en quiz stenges —
//                                     kjører hvert minutt, så det er DENNE som
//                                     i praksis gjør opp en fersk quiz først)
//
// Kadensene ligger hos cron-job.org, ikke i vercel.json, og er endret to ganger
// i august 2026. Tallene over er målt i Vercel-loggen 16. august — sjekk loggen
// på nytt før du bygger noe som avhenger av dem.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRowsChunked } from '@/lib/paginate'
import { fetchSettledSeasonAttempts } from '@/lib/season-attempts'
import {
  getSeasonPoints as getPoints,
  pickBestSeasonAttempt as pickBestAttempt,
  rankSeasonAttempts as rankBestAttempts,
  type SeasonAttempt as RawAttempt,
} from '@/lib/season-points'

type ScoreRow = {
  user_id: string
  quiz_id: string
  scope_type: string
  scope_id: string | null
  points: number
  rank: number
  closes_at: string
}

// MERGE-upsert (Endring 2, 24. august 2026): en konflikt på nøkkelen
// OPPDATERER raden i stedet for å hoppe over den. Det er dette som gjør
// rekjøringsvinduet i publish-quiz mulig — en sen innsending (forsøk startet
// før closes_at, levert innenfor SUBMIT_GRACE_MS) endrer ranks for spillere
// som allerede HAR rader, og med det gamle `ignoreDuplicates: true` var en
// gjenkjøring per definisjon en no-op. Konflikten fyrer også for global-rader
// med scope_id NULL: unik-indeksen er UNIQUE NULLS NOT DISTINCT
// (20260419_season_scores.sql).
//
// VIKTIG: beskyttelsen mot retroaktiv omskriving av historikk bodde tidligere
// i skrivemekanismen (ignoreDuplicates). Den bor nå i UTVALGET: rekjøring
// skjer kun for quizer med closes_at innenfor RESETTLE_SCAN_MS (se
// publish-quiz-cronen og lib/late-play-window.ts). En processQuiz-kjøring mot
// en gammel quiz VILLE nå omskrevet historiske plasseringer med dagens
// medlemskap — ikke kall den utenfor skannevinduet. Fasit-rettinger går
// fortsatt via resync (lib/season-resync-plan.ts), som rekonstruerer
// populasjonen fra de lagrede radene.
async function upsertScores(rows: ScoreRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabaseAdmin
    .from('season_scores')
    .upsert(rows, {
      onConflict: 'user_id,quiz_id,scope_type,scope_id',
    })
  if (error) throw error
}

export async function processQuiz(
  quizId: string,
  closesAt: string
): Promise<{ rows: number; error: string | null }> {
  // Populasjonen — LEVERTE solo-forsøk fra innloggede, paginert — er definert
  // ETT sted: lib/season-attempts.ts, delt med resync-season-scores. Se
  // kommentaren der for hvorfor submitted_at-filteret og pagineringen begge er
  // kritiske, og hvorfor definisjonen ikke skal kopieres inn hit igjen.
  let rawAttempts: RawAttempt[]
  try {
    rawAttempts = await fetchSettledSeasonAttempts(quizId)
  } catch (err) {
    return { rows: 0, error: err instanceof Error ? err.message : String(err) }
  }

  if (rawAttempts.length === 0) {
    await supabaseAdmin
      .from('quizzes')
      .update({ season_points_awarded: true })
      .eq('id', quizId)
    return { rows: 0, error: null }
  }

  const bestByUser = new Map<string, RawAttempt>()
  for (const a of rawAttempts) {
    const existing = bestByUser.get(a.user_id)
    bestByUser.set(a.user_id, existing ? pickBestAttempt(existing, a) : a)
  }

  const userIds = [...bestByUser.keys()]

  type Mem = { user_id: string; organization_id: string; global_league_opt_out: boolean | null }
  const globallyBlockedUserIds = new Set<string>()
  let orgMemberships: Mem[] = []

  // Del 1: akkumuler ALLE rader (global + liga + org) og gjør ÉN upsert til slutt.
  const allRows: ScoreRow[] = []

  try {
    // ── Org-medlemskap (blokkering fra global + grunnlag for org-scope) ────────
    // Brukere blokkeres fra global-rad hvis org har allow_global_league=false
    // eller memberen selv har global_league_opt_out=true. org-medlemskapet hentes
    // ÉN gang her og gjenbrukes for organization-scope lenger ned (fjerner tidligere
    // duplikat-lesing av organization_members).
    //
    // LIGGER NÅ INNE I try-BLOKKEN. Tidligere sto disse to spørringene utenfor og
    // destrukturerte kun `data`, aldri `error`. Feilet de, ble `data` null → `?? []`
    // → funksjonen gikk stille videre: ALLE org-sesongpoeng forsvant, OG
    // globallyBlockedUserIds ble stående tom, slik at brukere med
    // global_league_opt_out feilaktig fikk globale poeng. fetchAllRowsChunked
    // KASTER ved feil, så catch-en nedenfor fanger det og returnerer feilen i
    // stedet. Det er trygt: cronen setter aldri season_points_awarded ved feil,
    // så quizen prøves på nytt ved neste kjøring (hvert 30. minutt, og hvert
    // minutt via publish-quiz).
    //
    // CHUNKED: .in('user_id', userIds) legger hver id i URL-en. Målt mot prod
    // sprekker den mellom 380 og 400 id-er — altså FØR 1000-rads-taket. Se
    // lib/paginate.ts for målingene.
    if (userIds.length > 0) {
      orgMemberships = await fetchAllRowsChunked<Mem>(userIds, (chunk, from, to) =>
        supabaseAdmin
          .from('organization_members')
          .select('user_id, organization_id, global_league_opt_out')
          .in('user_id', chunk)
          .order('user_id', { ascending: true })
          .range(from, to)
      )
      if (orgMemberships.length > 0) {
        const orgIds = [...new Set(orgMemberships.map(m => m.organization_id))]
        const restrictedOrgs = await fetchAllRowsChunked<{ id: string }>(orgIds, (chunk, from, to) =>
          supabaseAdmin
            .from('organizations')
            .select('id')
            .in('id', chunk)
            .eq('allow_global_league', false)
            .order('id', { ascending: true })
            .range(from, to)
        )
        const restrictedOrgIds = new Set(restrictedOrgs.map(o => o.id))
        for (const m of orgMemberships) {
          if (restrictedOrgIds.has(m.organization_id) || m.global_league_opt_out === true) {
            globallyBlockedUserIds.add(m.user_id)
          }
        }
      }
    }

    // ── Global scope ───────────────────────────────────────────────────────────
    const globalRanked = rankBestAttempts(bestByUser)
    const globalRows: ScoreRow[] = globalRanked
      .filter(({ userId }) => !globallyBlockedUserIds.has(userId))
      .map(({ userId, rank }) => ({
        user_id: userId,
        quiz_id: quizId,
        scope_type: 'global',
        scope_id: null,
        points: getPoints(rank),
        rank,
        closes_at: closesAt,
      }))
    allRows.push(...globalRows)
    console.log(`[award-season-points]   global: ${globalRows.length} rader`)

    // ── League scope ───────────────────────────────────────────────────────────
    // Samme to grunner som org-blokken over: chunket fordi .in() sprekker på
    // URL-lengde rundt 390 id-er, og feil KASTES nå (tidligere ble `error` ikke
    // destrukturert i det hele tatt, så en feilet spørring fjernet stille alle
    // liga-sesongpoeng for quizen).
    const leagueMemberships = userIds.length > 0
      ? await fetchAllRowsChunked<{ league_id: string; user_id: string }>(userIds, (chunk, from, to) =>
          supabaseAdmin
            .from('league_members')
            .select('league_id, user_id')
            .in('user_id', chunk)
            .order('user_id', { ascending: true })
            .range(from, to)
        )
      : []

    if (leagueMemberships.length > 0) {
      const byLeague = new Map<string, string[]>()
      for (const lm of leagueMemberships) {
        if (!byLeague.has(lm.league_id)) byLeague.set(lm.league_id, [])
        byLeague.get(lm.league_id)!.push(lm.user_id)
      }

      for (const [leagueId, memberIds] of byLeague) {
        const leagueBest = new Map<string, RawAttempt>()
        for (const uid of memberIds) {
          const a = bestByUser.get(uid)
          if (a) leagueBest.set(uid, a)
        }
        if (leagueBest.size === 0) continue

        const ranked = rankBestAttempts(leagueBest)
        const rows: ScoreRow[] = ranked.map(({ userId, rank }) => ({
          user_id: userId,
          quiz_id: quizId,
          scope_type: 'league',
          scope_id: leagueId,
          points: getPoints(rank),
          rank,
          closes_at: closesAt,
        }))
        allRows.push(...rows)
      }
      console.log(`[award-season-points]   league: ${byLeague.size} ligaer`)
    }

    // ── Organization scope (gjenbruker orgMemberships hentet over) ──────────────
    if (orgMemberships.length > 0) {
      const byOrg = new Map<string, string[]>()
      for (const om of orgMemberships) {
        if (!byOrg.has(om.organization_id)) byOrg.set(om.organization_id, [])
        byOrg.get(om.organization_id)!.push(om.user_id)
      }

      for (const [orgId, memberIds] of byOrg) {
        const orgBest = new Map<string, RawAttempt>()
        for (const uid of memberIds) {
          const a = bestByUser.get(uid)
          if (a) orgBest.set(uid, a)
        }
        if (orgBest.size === 0) continue

        const ranked = rankBestAttempts(orgBest)
        const rows: ScoreRow[] = ranked.map(({ userId, rank }) => ({
          user_id: userId,
          quiz_id: quizId,
          scope_type: 'organization',
          scope_id: orgId,
          points: getPoints(rank),
          rank,
          closes_at: closesAt,
        }))
        allRows.push(...rows)
      }
      console.log(`[award-season-points]   org: ${byOrg.size} organisasjoner`)
    }

    // ── ÉN samlet upsert for alle scopes ────────────────────────────────────────
    // Unik-nøkkelen (user_id, quiz_id, scope_type, scope_id) skiller radene uansett
    // rekkefølge, så én upsert er ekvivalent med de tidligere per-scope-kallene —
    // bare ett round-trip i stedet for 4-9. Identisk poeng/rank per bruker/scope.
    await upsertScores(allRows)

    // Verifiser at rader faktisk finnes i season_scores før flagget settes
    const { count: writtenCount, error: countError } = await supabaseAdmin
      .from('season_scores')
      .select('id', { count: 'exact', head: true })
      .eq('quiz_id', quizId)

    if (countError || writtenCount === null || writtenCount === 0) {
      const reason = countError?.message ?? 'Ingen rader funnet i season_scores etter upsert'
      console.error(`[award-season-points] Verifisering feilet for quiz ${quizId}: ${reason}`)
      return { rows: allRows.length, error: reason }
    }

    const { error: flagError } = await supabaseAdmin
      .from('quizzes')
      .update({ season_points_awarded: true })
      .eq('id', quizId)

    if (flagError) {
      console.error(`[award-season-points] Klarte ikke sette season_points_awarded på quiz ${quizId}:`, flagError.message)
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[award-season-points] Upsert feil på quiz ${quizId}:`, errMsg)
    return { rows: allRows.length, error: errMsg }
  }

  return { rows: allRows.length, error: null }
}
