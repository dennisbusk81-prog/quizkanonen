import { supabase } from './supabase'

// ── Har brukeren spilt minst én gjort-opp quiz innlogget? ────────────────────
// Delt av /historikk og /historikk/[attemptId] sine 403-grener: svaret avgjør
// om en ikke-Premium-bruker skal se låseskjermen («poengene dine er lagret»)
// eller sendes til /premium.
//
// TO regler, begge fra VINDU A-kartleggingen 13. august 2026:
//
// 1. ALLE scopes, ikke bare 'global'. award-season-points hopper over
//    global-raden for brukere blokkert fra den åpne konkurransen (org med
//    allow_global_league=false, eller eget opt-out) — de har KUN
//    organization-/league-rader. Med `.eq('scope_type','global')` fikk hele
//    Elkjøp «har aldri spilt»-behandling og ble kastet til /premium selv med
//    full historikk. Spørsmålet «har brukeren spilt?» er scope-uavhengig;
//    listen er eksplisitt framfor et droppet filter, så en framtidig
//    scope-type ikke sklir inn uvurdert. RLS dekker alle tre for egne rader
//    (global: alle innloggede; org/liga: medlemskap — og en blokkert bruker
//    er per definisjon medlem).
//
// 2. FEIL er 'unknown', aldri «har ikke spilt». `count ?? 0` svelget feil:
//    en feilet spørring ga null → 0 → utkastelse. Samme fail-safe-retning som
//    getGloballyBlockedSet (5. august): når vi ikke VET, skal vi ikke handle
//    som om vi visste det verste. Kallerne behandler 'unknown' som 'yes'
//    (vis låseskjerm / send til /historikk) — å vise et informasjonskort til
//    en som aldri har spilt er en mild feil; å kaste en betalende kunde med
//    historikk til en salgsside er ikke.
export type SettledPlays = 'yes' | 'no' | 'unknown'

export async function hasSettledPlays(userId: string): Promise<SettledPlays> {
  const { count, error } = await supabase
    .from('season_scores')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('scope_type', ['global', 'organization', 'league'])
  if (error) return 'unknown'
  return (count ?? 0) > 0 ? 'yes' : 'no'
}
