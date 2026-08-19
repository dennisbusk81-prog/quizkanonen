/**
 * «Neste quiz: …» — ÉN kilde til både datovalg og formatering.
 *
 * Bakgrunn (19. august 2026): teksten ble regnet ut to steder i
 * `app/quiz/[id]/page.tsx`, og de to kopiene hadde drevet fra hverandre.
 * Resultatskjermen sjekket at datoen lå i framtiden og formaterte med
 * `timeZone: 'Europe/Oslo'`. Allerede-spilt-skjermen gjorde ingen av delene:
 * den skrev `site_settings.next_quiz_at` rått ut i nettleserens egen sone.
 * Verdien var manuelt satt til 2026-08-14T10:00:00Z og altså for lengst
 * passert, så skjermen lovet en quiz som hadde vært. Samme tilstand sto i sju
 * uker uten å bli oppdaget, og skjermen treffer alle som har spilt mens
 * fredagsquizen er åpen.
 *
 * Derfor er dette IKKE vakten kopiert til sted nummer to. To kopier av samme
 * regel er nettopp det som gikk galt. Begge kallstedene kaller `nextQuizLabel`,
 * og en foreldet `next_quiz_at` er etter dette ufarlig uansett hva som står i
 * basen: en passert dato faller stille tilbake på førstkommende fredag.
 *
 * `now` injiseres for at testene skal kunne stå ved midnatt og over et
 * månedsskifte uten å vente på kalenderen.
 */

const OSLO = 'Europe/Oslo'

// Fredag kl. 12:00 norsk tid — kadensen fredagsquizen faktisk åpner i.
const QUIZ_WEEKDAY = 5
const QUIZ_HOUR = 12

/**
 * Kalenderdato og klokketime slik de ser ut I OSLO, uavhengig av hvilken sone
 * nettleseren står i.
 *
 * Hele fallback-regnestykket må gjøres i Oslo-termer. Den forrige inline-koden
 * blandet de to: ukedagen ble hentet fra Oslo, men dagen det ble lagt til
 * (`now.getDate()`) var nettleserens LOKALE dato. For en spiller i UTC kl.
 * 23:30 er det allerede neste dag i Oslo, og «førstkommende fredag» bommet med
 * ett døgn.
 */
function osloCalendar(now: Date): { year: number; month: number; day: number; hour: number } {
  // en-CA gir ISO-formen (2026-08-19) og er derfor trygg å splitte på.
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: OSLO, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).split('-').map(Number)
  // hourCycle h23 — ellers kommer midnatt ut som «24» og gjør timesjekken feil.
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: OSLO, hour: '2-digit', hourCycle: 'h23',
  }).format(now))
  return { year, month, day, hour }
}

/** Ukedag (0=søndag) for en Oslo-kalenderdato. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/**
 * Datoen bare hvis den ligger i FRAMTIDEN. Null for tom, ugyldig eller passert
 * verdi — kalleren skal ikke kunne skille dem, alle tre betyr «vi har ingen
 * annonsert dato å vise».
 */
export function upcomingQuizDate(nextQuizAt: string | null | undefined, now: Date): Date | null {
  if (!nextQuizAt) return null
  const d = new Date(nextQuizAt)
  if (Number.isNaN(d.getTime())) return null
  return d.getTime() > now.getTime() ? d : null
}

/** Førstkommende fredag kl. 12:00, regnet og skrevet i Oslo-tid. */
export function nextFridayLabel(now: Date): string {
  const { year, month, day, hour } = osloCalendar(now)
  let daysUntil = (QUIZ_WEEKDAY - weekdayOf(year, month, day) + 7) % 7
  // Er det fredag, men klokka har passert 12, er dagens quiz allerede åpnet —
  // neste er om en uke.
  if (daysUntil === 0 && hour >= QUIZ_HOUR) daysUntil = 7
  // UTC-midnatt som ren kalenderaritmetikk: `Date.UTC` normaliserer overflyt
  // over måneds- og årsskifte selv, og formateres tilbake i UTC, så ingen
  // sommertidsovergang kan skyve datoen en dag.
  const target = new Date(Date.UTC(year, month - 1, day + daysUntil))
  const dateStr = target.toLocaleDateString('nb-NO', { timeZone: 'UTC', day: 'numeric', month: 'long' })
  return `fredag ${dateStr} kl. ${String(QUIZ_HOUR).padStart(2, '0')}:00`
}

/** Den annonserte datoen, alltid skrevet i norsk tid. */
export function formatQuizDate(d: Date): string {
  return d.toLocaleString('nb-NO', {
    timeZone: OSLO,
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Teksten begge skjermene viser. Returnerer ALLTID en streng: uten en gyldig
 * framtidig dato er fredags-fallbacken riktigere enn å skjule linja, fordi
 * quizen faktisk kommer på fredag uansett hva `site_settings` inneholder.
 */
export function nextQuizLabel(nextQuizAt: string | null | undefined, now: Date = new Date()): string {
  const upcoming = upcomingQuizDate(nextQuizAt, now)
  return upcoming ? formatQuizDate(upcoming) : nextFridayLabel(now)
}
