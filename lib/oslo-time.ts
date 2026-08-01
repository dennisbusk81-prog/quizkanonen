// Konvertering mellom norsk veggklokke og faktiske UTC-instanter.
//
// Bakgrunn: `organizations.org_quiz_opens_at` / `org_quiz_closes_at` er
// PostgreSQL TIME-kolonner som fylles av et `<input type="time">` i
// org-admin-panelet. Verdien er altså en NORSK veggklokke ("15:00") uten
// tidssone — og admin-UI-et leser den rå tilbake inn i det samme feltet, så
// den kan ikke lagres om til UTC uten at panelet begynner å vise et annet
// klokkeslett enn det som ble skrevet inn.
//
// Fram til 1. august 2026 ble den limt sammen med quiz-datoen som
// `${dato}T${tid}.000Z` — altså tolket som UTC. Om sommeren (CEST, UTC+2)
// betydde det at en admin som satte "15:00" reelt fikk stenging kl. 17:00
// norsk tid, og en «en time igjen»-e-post kl. 16:00. Feilen var inert i prod
// (ingen org hadde satt feltet), men ville rammet den første som gjorde det.
//
// Løsningen: la lagringen være rå veggklokke, og tolk den eksplisitt som
// Europe/Oslo her, i det ene punktet der tidsstemplet faktisk bygges.

const OSLO_TZ = 'Europe/Oslo'

const OSLO_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: OSLO_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** "HH:MM" eller "HH:MM:SS" — samme format som TIME-kolonnen kan gi tilbake. */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function osloParts(utcMs: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of OSLO_PARTS.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value)
  }
  return out
}

/**
 * Offsetet (i ms) mellom Europe/Oslo og UTC på et gitt instant.
 * +1t om vinteren (CET), +2t om sommeren (CEST).
 */
function osloOffsetMsAt(utcMs: number): number {
  const p = osloParts(utcMs)
  // `hour` kan bli 24 for midnatt i enkelte ICU-versjoner med hour12:false.
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second)
  return asIfUtc - utcMs
}

/** Kalenderdatoen ("YYYY-MM-DD") et instant faller på i Norge. */
export function osloDateString(iso: string): string | null {
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return null
  const p = osloParts(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/**
 * Tolker (dato, veggklokke) som norsk lokaltid og gir det tilsvarende
 * UTC-instantet som ISO-streng. Returnerer null på ugyldig input — kallerne
 * skal hoppe over raden i stedet for å regne videre på en Invalid Date
 * (`new Date(NaN).toISOString()` kaster RangeError).
 *
 *   osloWallClockToUtcIso('2026-08-07', '15:00') → '2026-08-07T13:00:00.000Z'
 *   osloWallClockToUtcIso('2026-12-04', '15:00') → '2026-12-04T14:00:00.000Z'
 */
export function osloWallClockToUtcIso(dateYmd: string, time: string): string | null {
  if (!DATE_RE.test(dateYmd)) return null
  const m = TIME_RE.exec(time)
  if (!m) return null

  const [year, month, day] = dateYmd.split('-').map(Number)
  const naiveMs = Date.UTC(year, month - 1, day, Number(m[1]), Number(m[2]), Number(m[3] ?? 0))
  if (Number.isNaN(naiveMs)) return null

  // To steg: offsetet avhenger av instantet, men instantet er nettopp det vi
  // leter etter. Første gjetning bruker offsetet ved den naive verdien, andre
  // runde korrigerer den — det er nok til å treffe riktig side av en
  // sommertid-overgang, siden overgangen flytter klokka med maks én time.
  const firstGuess = naiveMs - osloOffsetMsAt(naiveMs)
  const utcMs = naiveMs - osloOffsetMsAt(firstGuess)
  return new Date(utcMs).toISOString()
}
