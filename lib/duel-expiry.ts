// ── Delt utløpsregel for H2H Duell ──────────────────────────────────────────
// ÉN kilde til sannhet for spørsmålet «lever denne duellen fortsatt?».
//
// Bakgrunn (kartlegging 28. juli 2026, FUNN 2.2): regelen fantes tidligere i to
// utgaver som ikke var enige med hverandre.
//
//   - app/api/rivalries/my (UI):   pending utløper etter 14 dager
//   - app/api/rivalries (POST):    pending blokkerer så lenge den er opprettet
//                                  denne kalendermåneden — uansett alder
//
// Konsekvensen var en dødlås: en ubesvart utfordring sendt dag 1–17 i måneden
// ble borte fra UI-et etter 14 dager (og mistet dermed «Trekk tilbake»-
// knappen), men fortsatte å blokkere nye dueller for BEGGE parter resten av
// måneden. Ingen vei ut uten å vente på månedsskiftet.
//
// Nå bruker POST, /my og opprydningsjobben nøyaktig denne filen.

/** Fast svarvindu for en ubesvart (pending) utfordring. */
export const PENDING_REPLY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Statuser en rivalry-rad kan ha.
 *
 * 'expired' settes av /api/cron/expire-duels og er kun en materialisering av
 * det `isDuelExpired()` uansett ville regnet ut. Koden er bevisst korrekt både
 * før og etter at den statusen tas i bruk — tidsregelen under gjelder like
 * fullt for en rad som fortsatt står som 'pending'.
 */
export type DuelStatus = 'pending' | 'active' | 'declined' | 'cancelled' | 'expired'

/** Starten på inneværende kalendermåned (UTC). */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * Er duellen over?
 *
 * To ulike regler, med vilje:
 *   - pending: fast 14-dagersvindu fra opprettelse. En kalendermåned-grense ga
 *     et vilkårlig svarvindu (noen timer til nesten en måned, avhengig av
 *     hvilken dag i måneden utfordringen ble sendt).
 *   - active:  kalendermåneden duellen ble opprettet i. Poengene telles per
 *     kalendermåned, så duellen skal være synlig som pågående til måneden er
 *     omme — et flatt 14-dagersvindu ville skjult en duell akseptert tidlig i
 *     måneden mens poengsummen fortsatt tikket.
 */
export function isDuelExpired(status: string, createdAtIso: string, now: Date): boolean {
  if (status === 'expired') return true
  const createdAt = new Date(createdAtIso)
  if (status === 'pending') {
    return now.getTime() - createdAt.getTime() > PENDING_REPLY_WINDOW_MS
  }
  return createdAt.getTime() < monthStartUtc(now).getTime()
}

/**
 * Skal denne raden hindre at brukeren starter en ny duell?
 *
 * Kun levende dueller blokkerer. Avslåtte, kansellerte og utløpte gjør det
 * ikke — det er nettopp den forskjellen dødlåsen manglet.
 */
export function blocksNewDuel(
  row: { status: string; created_at: string },
  now: Date,
): boolean {
  if (row.status !== 'pending' && row.status !== 'active') return false
  return !isDuelExpired(row.status, row.created_at, now)
}
