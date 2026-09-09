/**
 * Skiller «spørringen lyktes og ga null rader» fra «spørringen feilet» for
 * `.single()`-oppslag.
 *
 * `.single()` ber PostgREST om ett JSON-objekt (`Accept:
 * application/vnd.pgrst.object+json`). Gir spørringen 0 rader, svarer
 * serveren 406 med kode PGRST116 — altså som en ERROR, selv om databasen
 * svarte fint. Verifisert empirisk mot prod 9. september 2026 på `profiles`,
 * `organization_members` og `organizations`:
 *
 *   {"code":"PGRST116","details":"The result contains 0 rows",
 *    "message":"Cannot coerce the result to a single JSON object"}   HTTP 406
 *
 * En ekte feil har en annen kode (f.eks. 42703 ukjent kolonne, 42501
 * manglende grant, 57P01 avbrutt tilkobling). Fram til punkt 7 (9. september
 * 2026) leste fire steder `.single()` uten error i det hele tatt, så en DB-feil
 * ble «ingen abonnement» / «ingen admin-tilgang» / «kontakt support». Fellen i
 * fiksen er å skille på OM error finnes: da blir alle uten abonnement til
 * «kontakt support». Skillet MÅ gå på koden.
 *
 * Merk: postgrest-js setter samme kode selv ved `.maybeSingle()` med >1 rad
 * (klient-side etterligning). Den stien bruker ikke rutene her.
 */
export const POSTGREST_NO_ROWS = 'PGRST116'

export function isNoRowsError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  return !!error && error.code === POSTGREST_NO_ROWS
}
