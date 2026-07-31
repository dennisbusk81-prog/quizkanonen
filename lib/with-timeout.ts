// Én invariant: et nettverkskall som aldri fullfører skal ALDRI kunne holde en
// await-punkt åpent for alltid.
//
// Bakgrunn (1. august 2026): `goToNext` i app/quiz/[id]/page.tsx gjorde
// `await Promise.all([...])` på tre fetch-kall uten noen øvre tidsgrense. Et
// fetch som stopper opp på klienten — serveren kan ha logget 200 OK — gjør at
// promiset aldri settles. Knappen sto i «Laster…» til evig tid, og eneste vei
// videre for spilleren var å laste siden på nytt. Én ekte spiller frøs slik to
// ganger i overgangen spørsmål 14→15.
//
// Utfallet er en diskriminert union av samme grunn som `Loaded<T>` i
// lib/fetch-result.ts: en kaller kan ikke lese `value` uten først å ha sjekket
// `ok`, og «tok for lang tid» skilles fra «feilet» slik at UI-et kan si det
// riktige til spilleren.
export type TimedOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; timedOut: boolean }

// Kun de to timer-funksjonene vi bruker — injiserbare så testene kan bevise at
// timeren faktisk ryddes opp når promiset rekker fram først.
export type TimerApi = {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type TimeoutOptions = {
  ms: number
  // Kalles KUN ved timeout, etter at utfallet er avgjort. Her hører
  // `controller.abort()` hjemme: uten den ville det hengende kallet fortsatt
  // ligge og vente i bakgrunnen og kunne lande midt i et nytt forsøk.
  onTimeout?: () => void
  timers?: TimerApi
}

const realTimers: TimerApi = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export async function withTimeout<T>(
  promise: Promise<T>,
  { ms, onTimeout, timers = realTimers }: TimeoutOptions,
): Promise<TimedOutcome<T>> {
  let handle: unknown
  const deadline = new Promise<TimedOutcome<T>>(resolve => {
    handle = timers.setTimeout(() => resolve({ ok: false, timedOut: true }), ms)
  })

  // Begge armene av .then: en rejection gjøres om til en VERDI, ikke en
  // rejection av withTimeout selv. Det er hele poenget med utfalls-unionen —
  // kalleren skal kunne skille «feilet» fra «tok for lang tid» uten try/catch,
  // og en glemt catch hos en kaller skal ikke kunne bli en ny frys.
  const settled = promise.then(
    (value): TimedOutcome<T> => ({ ok: true, value }),
    (): TimedOutcome<T> => ({ ok: false, timedOut: false }),
  )

  const outcome = await Promise.race([settled, deadline])
  // Ryddes uansett utfall — ellers holder en 9 sekunders timer event-loopen
  // (og i praksis komponenten) i live lenge etter at svaret er på plass.
  timers.clearTimeout(handle)
  if (!outcome.ok && outcome.timedOut) onTimeout?.()
  return outcome
}

// For kallere der resultatet allerede er valgfritt — rangeringskallene i
// mellomskjermen fanger selv og returnerer null ved feil, og skal degradere på
// samme måte når de tar for lang tid. De må likevel ha en grense: de ligger i
// samme `Promise.all` som spørsmålshentingen, så et hengende rangeringskall
// alene ville frosset skjermen like effektivt.
export async function withTimeoutOrNull<T>(
  promise: Promise<T | null>,
  options: TimeoutOptions,
): Promise<T | null> {
  const outcome = await withTimeout(promise, options)
  return outcome.ok ? outcome.value : null
}
