import { supabaseAdmin } from './supabase-admin'
import { fetchAllRows, fetchAllRowsChunked } from './paginate'
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
// live oppslaget (organizations + organization_members). Ingen tilbakevirkende
// kraft er mulig i det vinduet.
//
// MERK: settet er utledet fra SOLO-populasjonen (award/season_scores gjelder
// is_team=false). Bruk det ikke til å filtrere lag-rommet — en lagleder uten
// solo-forsøk ville da feilaktig regnes som blokkert på en gjort-opp quiz.
//
// ═══════════════════════════════════════════════════════════════════════════
// TRE ENDRINGER 5. AUGUST 2026 (funn F2 i lastmålingen) — les før du rører noe
// ═══════════════════════════════════════════════════════════════════════════
//
// ── 1. FEIL ER NÅ STENGT, IKKE ÅPENT (retningen er SNUDD) ───────────────────
// Fram til nå sto det eksplisitt «FEIL ER ÅPENT, IKKE STENGT» her: klarte vi
// ikke lese fasiten, ble et TOMT sett returnert, altså «ingen er blokkert».
// Det er feil retning for det dette laget faktisk vokter. Settet er ikke en
// pynt — det er løftet vi har gitt bedriftskundene om at resultatene deres kan
// holdes interne. Et tomt sett publiserer navnene deres på den åpne
// topplisten, og det er en tilstand som ikke kan angres etter at siden er sett.
//
// Ny regel: klarer vi ikke avgjøre hvem som er blokkert, blokkeres ALLE
// spillerne kalleren spurte om. Da vises en tom liste i stedet for en
// feilaktig komplett en.
//
// KJENN PRISEN, den er reell: en forbigående DB-feil tømmer hele den
// offentlige topplisten for ALLE spillere, ikke bare org-medlemmene, i inntil
// ett kall (feil caches aldri, se under). En tom toppliste er sin egen stille
// løgn — den leses som «ingen har spilt». Vi tar den prisen bevisst, fordi det
// motsatte utfallet er en personvernlekkasje mot en betalende kunde, og fordi
// endring 2 under gjør en feil her vesentlig mindre sannsynlig enn den var.
//
// ── 2. LIVE-GRENEN SPØR PER ORGANISASJON, ALDRI PER SPILLERLISTE ────────────
// Den gamle live-grenen gjorde `.in('user_id', attemptUserIds)` med ALLE som
// hadde levert. Målt grense for `.in()` er ~390 id-er før URL-en sprenger (se
// lib/paginate.ts) — og feilen ble ikke sjekket, så over den grensen ble
// `data` null, settet tomt, og alle org-medlemmer eksponert. Nøyaktig den
// feilklassen endring 1 finnes for, utløst av helt ordinær vekst.
//
// Spørringen er derfor snudd: vi spør hvilke ORGANISASJONER som har skrudd av
// global liga, og hvem som er medlem der — aldri hvilke organisasjoner
// spillerne tilhører. Antall spillere påvirker da ingen URL-lengde, og taket
// på ~390 kan strukturelt ikke nås på bruker-aksen uansett hvor mange som
// spiller. Begge oppslagene er dessuten paginert (fetchAllRows), så det stille
// 1000-radertaket er dekket på samme sted.
//
// Bieffekt, med vilje: live-grenen returnerer nå et SUPERSETT — alle blokkerte
// brukere, ikke bare de som spilte denne quizen. Kallerne slår kun opp med
// `.has(userId)` for brukere de allerede har i hånden, så et supersett er
// funksjonelt identisk. Kallere som gater på `blocked.size > 0` før de
// filtrerer får samme resultat: filteret fjerner da ingen, og en posisjonell
// re-rank av en uendret liste gir de samme plasseringene.
//
// ── 3. CACHEN LAGRER FAKTA, IKKE ET FERDIG SETT ─────────────────────────────
// Cachen var nøklet på quiz-id alene, men lagret et sett som for den
// gjort-opp-grenen var utledet av kallerens `attemptUserIds`. To kallere spør
// med ULIKE lister om samme quiz — /standings sender kun de som har LEVERT,
// /leaderboard sender alle med et forsøk. Vant den korteste lista cachen
// først, manglet den lengste kalleren blokkeringer for brukere som ikke var
// med i den første lista: under-blokkering, altså samme lekkasje som over,
// bare utløst av rekkefølgen på to forespørsler.
//
// Cachen lagrer nå det list-uavhengige FAKTAGRUNNLAGET (hvem fikk global-rad /
// hvem er blokkert nå), og settet utledes per kall mot kallerens egen liste.
// ═══════════════════════════════════════════════════════════════════════════

// Modul-lokal cache per serverless-instans (samme mønster/TTL som
// last_quiz-attempts-cachen i toppliste-ruten — se kommentaren der om hvorfor
// revalidateTag ikke er et alternativ og opptil 30 s utdatert visning er
// bevisst akseptert).
const BLOCKED_SET_CACHE_TTL_MS = 30_000

// Faktagrunnlaget, ikke svaret. Se endring 3 over.
type BlockedFacts =
  // Gjort opp: hvem som FIKK en global season_scores-rad. Blokkert = spurt om,
  // men ikke i denne lista. Avhenger av kallerens liste, derfor lagres kilden.
  | { kind: 'awarded'; scoredUserIds: string[] }
  // Ikke gjort opp: hvem som er blokkert akkurat nå, uavhengig av hvem som
  // spilte. Kan brukes direkte.
  | { kind: 'live'; blockedUserIds: Set<string> }

const globallyBlockedFactsCache = new Map<string, { facts: BlockedFacts; expires: number }>()

function deriveFromFacts(facts: BlockedFacts, attemptUserIds: string[]): Set<string> {
  return facts.kind === 'awarded'
    ? deriveBlockedFromScores(attemptUserIds, facts.scoredUserIds)
    : facts.blockedUserIds
}

/**
 * Hvem fikk en global season_scores-rad for denne quizen — det persisterte
 * vedtaket fra da quizen ble gjort opp.
 *
 * Paginert: season_scores kan passere 1000 rader for én quiz, og PostgREST
 * kutter da stille (se lib/paginate.ts). Filtrerer på quiz_id framfor
 * `.in('user_id', …)` slik at URL-lengdegrensen ved ~390 id-er ikke er
 * relevant her heller.
 *
 * Kaster ved DB-feil (fetchAllRows kaster) — kalleren skal fail-safe, ikke
 * tolke et tomt resultat som «ingen blokkert».
 */
async function fetchScoredUserIds(quizId: string): Promise<string[]> {
  const rows = await fetchAllRows<{ user_id: string }>((from, to) =>
    supabaseAdmin
      .from('season_scores')
      .select('user_id')
      .eq('quiz_id', quizId)
      .eq('scope_type', 'global')
      .is('scope_id', null)
      .order('user_id', { ascending: true })
      .range(from, to)
  )
  return rows.map(r => r.user_id)
}

/**
 * Hvem er blokkert fra den globale ligaen akkurat nå.
 *
 * Spør per ORGANISASJON, aldri per spillerliste (se endring 2 i toppkommentaren).
 * To uavhengige kilder til blokkering, begge paginert:
 *   a) medlem av en org med allow_global_league = false
 *   b) eget global_league_opt_out = true, uansett org
 *
 * Merk `.eq('allow_global_league', false)`: NULL regnes som TILLATT, samme
 * tolkning som /api/org/my-orgs (`allow_global_league !== false`) og som den
 * tidligere spørringen i toppliste-ruten. Kun et eksplisitt `false` blokkerer.
 *
 * Kaster ved DB-feil — kalleren skal fail-safe.
 */
async function fetchLiveBlockedUserIds(): Promise<Set<string>> {
  const restrictedOrgs = await fetchAllRows<{ id: string }>((from, to) =>
    supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('allow_global_league', false)
      .order('id', { ascending: true })
      .range(from, to)
  )
  const restrictedOrgIds = restrictedOrgs.map(o => o.id)

  // Chunket på org-id: organisasjoner er få, men listen er brukerstyrt i
  // prinsippet, og fetchAllRowsChunked dekker begge takene på én gang.
  const [membersOfRestrictedOrgs, selfOptedOut] = await Promise.all([
    restrictedOrgIds.length > 0
      ? fetchAllRowsChunked<OrgMembership>(restrictedOrgIds, (chunk, from, to) =>
          supabaseAdmin
            .from('organization_members')
            .select('user_id, organization_id, global_league_opt_out')
            .in('organization_id', chunk)
            .order('user_id', { ascending: true })
            .range(from, to)
        )
      : Promise.resolve([] as OrgMembership[]),
    fetchAllRows<OrgMembership>((from, to) =>
      supabaseAdmin
        .from('organization_members')
        .select('user_id, organization_id, global_league_opt_out')
        .eq('global_league_opt_out', true)
        .order('user_id', { ascending: true })
        .range(from, to)
    ),
  ])

  // Samme rene helper som før — den avgjør fortsatt REGELEN (org-restriksjon
  // ELLER eget opt-out). Her mates den med begge kildene samlet; duplikater er
  // harmløse, resultatet er et Set.
  return deriveBlockedFromLiveStatus(
    [...membersOfRestrictedOrgs, ...selfOptedOut],
    new Set(restrictedOrgIds)
  )
}

export async function getGloballyBlockedSet(
  quizId: string,
  attemptUserIds: string[],
  seasonPointsAwarded: boolean
): Promise<Set<string>> {
  // Ingen å svare om → ingen blokkering, uten oppslag. Dette er ikke et brudd
  // på fail-safe-regelen: et tomt svar på et tomt spørsmål skjuler ingen.
  if (attemptUserIds.length === 0) return new Set<string>()

  const now = Date.now()
  const cached = globallyBlockedFactsCache.get(quizId)
  if (cached && cached.expires > now) return deriveFromFacts(cached.facts, attemptUserIds)

  let facts: BlockedFacts
  try {
    facts = seasonPointsAwarded
      ? { kind: 'awarded', scoredUserIds: await fetchScoredUserIds(quizId) }
      : { kind: 'live', blockedUserIds: await fetchLiveBlockedUserIds() }
  } catch (err) {
    // FAIL-SAFE STENGT. Vi vet ikke hvem som er blokkert, så alle skjules.
    // Se endring 1 i toppkommentaren for hvorfor retningen er denne.
    //
    // Feilen caches ALDRI: neste forespørsel skal få et ekte forsøk, ikke
    // arve en tom liste i 30 sekunder.
    //
    // Logges høyt fordi tilstanden er synlig for brukerne (tom toppliste) og
    // fordi Sentry nå fanger den — en stille fail-safe ville sett ut som at
    // ingen hadde spilt.
    console.error('[globally-blocked-set] kunne ikke avgjøre blokkerte — skjuler alle:', {
      quizId,
      seasonPointsAwarded,
      spurteOm: attemptUserIds.length,
      error: err instanceof Error ? err.message : String(err),
    })
    return new Set(attemptUserIds)
  }

  if (globallyBlockedFactsCache.size > 50) {
    for (const [k, v] of globallyBlockedFactsCache) if (v.expires <= now) globallyBlockedFactsCache.delete(k)
  }
  globallyBlockedFactsCache.set(quizId, { facts, expires: now + BLOCKED_SET_CACHE_TTL_MS })
  return deriveFromFacts(facts, attemptUserIds)
}
