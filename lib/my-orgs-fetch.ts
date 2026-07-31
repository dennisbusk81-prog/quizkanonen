import { fetchResult, type Loaded, type MinimalResponse } from './fetch-result'

/**
 * Én delt sannhet for hvordan et svar fra `/api/org/my-orgs` blir til
 * klient-state. Samme form og begrunnelse som lib/members-activity-fetch.ts.
 *
 * Bakgrunn (31. juli 2026): ProfileProvider gjorde
 *   fetch(...).then(r => r.ok ? r.json() : { orgs: [] }).catch(() => ({ orgs: [] }))
 * mens ruten SELV svarte 200 med `{ orgs: [] }` på både ugyldig token og
 * DB-feil. Begge lagene kollapset altså «vet ikke» til «ingen medlemskap», og
 * /org/[slug] fortalte ekte ansatte at de ikke var medlem. Ruten svarer nå
 * 401/500 på de to, og denne funksjonen sørger for at forskjellen overlever
 * hele veien til context-state.
 *
 * En TOM liste med 200 er fortsatt et gyldig svar: en bruker KAN reelt være
 * uten bedrift, og det har vi lov til å vise.
 */
export type MyOrgsResult<T> = Loaded<T[]>

export async function fetchMyOrgsResult<T>(
  run: () => Promise<MinimalResponse>
): Promise<MyOrgsResult<T>> {
  return fetchResult(run, json => (json as { orgs?: T[] } | null)?.orgs ?? [])
}
