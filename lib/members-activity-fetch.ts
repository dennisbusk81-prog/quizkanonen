import { fetchResult, type MinimalResponse } from './fetch-result'

// Én delt sannhet for hvordan et svar fra members-activity blir til klient-state.
//
// Bakgrunn: både org-admin og liga-eiersiden gjorde
//   const json = res.ok ? await res.json() : { members: [] }
// som oversetter ENHVER feil — inkludert 500-en rutene fikk nettopp for å unngå
// stille degradering — tilbake til en tom liste. Admin så da «ingen aktivitet»
// der sannheten var «vi vet ikke». Fiksen i ruten var usynlig for brukeren.
//
// Skillet som må overleve: «tomt» og «vet ikke» er to ULIKE utfall, og de kan
// aldri kollapse til samme verdi. Derfor er dette en diskriminert union og ikke
// en array som kan være tom av to grunner.
export type MembersActivityResult<T> =
  | { ok: true; members: T[] }
  | { ok: false }

// Selve ok/ikke-ok-skillet bor i lib/fetch-result.ts og deles med
// sesongvinnerne, som har en annen nyttelast men nøyaktig samme invariant.
// Denne funksjonen beholdes som medlemsliste-formen av det.
export async function fetchMembersActivity<T>(
  run: () => Promise<MinimalResponse>
): Promise<MembersActivityResult<T>> {
  // 200 uten members er reelt tomt — en bedrift/liga KAN ha null medlemmer, og
  // det er en sannhet vi har lov til å vise. Det er kun feilsvar som ikke skal
  // kunne bli til en tom liste.
  const result = await fetchResult(run, json => (json as { members?: T[] } | null)?.members ?? [])
  return result.ok ? { ok: true, members: result.value } : { ok: false }
}
