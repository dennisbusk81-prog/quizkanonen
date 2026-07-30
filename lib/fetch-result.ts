// Den ene invarianten: et feilsvar er «vet ikke», ALDRI «tomt».
//
// Feilklassen har oppstått tre ganger nå (org-admin members-activity,
// liga members-activity, org-admin sesongvinnere), hver gang fordi mønsteret
//   const json = res.ok ? await res.json() : { <tom form> }
// måtte huskes på nytt i hver kaller. Den kollapser to ULIKE utfall til samme
// verdi, og skjermen påstår så noe vi ikke vet: «ingen aktivitet», «ikke kåret
// ennå», «ingen medlemmer».
//
// Derfor er dette en diskriminert union og ikke en tom verdi: en kaller kan
// ikke lese `value` uten først å ha sjekket `ok`.
export type Loaded<T> = { ok: true; value: T } | { ok: false }

// Kun den delen av fetch-kontrakten vi faktisk bruker — gjør funksjonen testbar
// uten en ekte Response.
export type MinimalResponse = { ok: boolean; json: () => Promise<unknown> }

export async function fetchResult<T>(
  run: () => Promise<MinimalResponse>,
  extract: (json: unknown) => T
): Promise<Loaded<T>> {
  try {
    const res = await run()
    // Enhver ikke-ok status er «vet ikke» — særlig 500, som er rutenes måte å
    // si at et oppslag feilet.
    if (!res.ok) return { ok: false }
    // extract kjører innenfor try med vilje: ugyldig JSON eller en uventet
    // form er også «vet ikke», ikke en halvveis lest verdi.
    return { ok: true, value: extract(await res.json()) }
  } catch {
    return { ok: false }
  }
}
