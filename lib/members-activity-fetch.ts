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

// Kun det fetch-kontrakten vi faktisk bruker — gjør funksjonen testbar uten
// en ekte Response.
type MinimalResponse = { ok: boolean; json: () => Promise<unknown> }

export async function fetchMembersActivity<T>(
  run: () => Promise<MinimalResponse>
): Promise<MembersActivityResult<T>> {
  try {
    const res = await run()
    // Enhver ikke-ok status er «vet ikke». Særlig 500: den er RUTENS måte å si
    // at aktivitets-oppslaget feilet, og skal aldri bli til en tom liste.
    if (!res.ok) return { ok: false }
    const json = await res.json() as { members?: T[] } | null
    // 200 uten members er derimot reelt tomt — en bedrift/liga kan ha null
    // medlemmer, og det er en sannhet vi har lov til å vise.
    return { ok: true, members: json?.members ?? [] }
  } catch {
    // Nettverksfeil eller ugyldig JSON: også «vet ikke», ikke «tomt».
    return { ok: false }
  }
}
