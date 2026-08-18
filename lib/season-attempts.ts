import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchAllRows } from '@/lib/paginate'
import type { SeasonAttempt } from '@/lib/season-points'

// ── ÉN populasjonsdefinisjon for sesongpoeng ─────────────────────────────────
// Delt av processQuiz (lib/award-season-points.ts, som SKRIVER season_scores)
// og resyncSeasonScoresForQuiz (lib/resync-season-scores.ts, som RETTER dem
// etter en fasitendring). De to MÅ regne over samme felt: retter resync
// plasseringer mot en annen populasjon enn den som skrev dem, «retter» den
// feil. Fram til 19. august 2026 var dette to identiske inline-spørringer —
// trukket ut hit nettopp så de ikke kan drifte fra hverandre igjen.
//
// `submitted_at IS NOT NULL` er selve deltaker-definisjonen: start-attempt
// oppretter raden med correct_answers=0 og total_time_ms=0 FØR spilling, og
// submit er det eneste som fyller den. Uten filteret fikk påbegynte-og-
// forlatte forsøk sesongpoeng — målt i prod 18. august 2026: 8 rader fordelt
// på fire fredagsquizer (19.06–07.08), alle fra forsøk som aldri ble levert.
// En slik 0/0-rad sorterer dessuten med 0 ms FORAN enhver ekte spiller med 0
// riktige. Alle visningsflatene (ranking-snapshot, leaderboard, toppliste
// last_quiz, rivalries) filtrerer allerede på submitted_at; dette er samme
// regel på skrivesiden. Se QK_1s populasjonsmarkører: «Å ha STARTET en quiz
// er ikke å ha DELTATT.»
//
// PAGINERT: uten eksplisitt range() kutter PostgREST stille ved 1000 rader.
// Dette er den alvorligste avkuttingen i kodebasen: hver rad her er en
// innlogget spiller som skal ha sesongpoeng. Ved >1000 spillere ville de
// overskytende ikke bare fått feil poeng — de ville ikke fått NOEN rad i
// season_scores, og alle andres rank ville blitt regnet mot en delvis
// populasjon. Og fordi upsertScores bruker ignoreDuplicates: true, ville en
// ny kjøring ALDRI rettet det opp — tapet er permanent. .order('id') gjør
// sidene deterministiske; rangeringen gjør uansett sin egen totalordning,
// så resultatet er uavhengig av input-rekkefølgen.
//
// Kaster ved feil (fetchAllRows) — begge kallerne fanger og returnerer
// feilen i stedet for å gå stille videre med en tom liste.
export function fetchSettledSeasonAttempts(quizId: string): Promise<SeasonAttempt[]> {
  return fetchAllRows<SeasonAttempt>((from, to) =>
    supabaseAdmin
      .from('attempts')
      .select('user_id, correct_answers, total_time_ms, correct_streak')
      .eq('quiz_id', quizId)
      .eq('is_team', false)
      .not('user_id', 'is', null)
      .not('submitted_at', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
  )
}
