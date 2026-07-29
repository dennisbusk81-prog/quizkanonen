// Regler for PLANLAGT fjerning av et org-medlem.
//
// Ren logikk, ingen I/O — samme deling som lib/invite-quota.ts (ren) og
// lib/org-name.ts (ren), med I/O-en i lib/org-member-removal.ts.
//
// TIDSPUNKT: admin velger en DATO, ikke et klokkeslett. Vi lagrer UTC-midnatt
// på den datoen, og cronen fjerner når `scheduled_removal_at <= now()`. Med en
// daglig kjøring tidlig om morgenen betyr «2. august» at medlemmet beholder
// tilgangen gjennom hele 1. august og mister den tidlig 2. august — nøyaktig
// det bekreftelsesmodalen lover brukeren.

export const MIN_DAYS_AHEAD = 1
export const MAX_MONTHS_AHEAD = 12

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type ScheduledRemovalResult =
  | { ok: true; /** ISO-tidspunkt å lagre i scheduled_removal_at */ at: string }
  | { ok: false; error: string }

/** UTC-midnatt for et Date-objekt — brukt både på input og på «i dag». */
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export function validateScheduledRemovalDate(
  raw: unknown,
  now: Date = new Date(),
): ScheduledRemovalResult {
  if (typeof raw !== 'string' || !DATE_RE.test(raw.trim())) {
    return { ok: false, error: 'Oppgi en gyldig dato.' }
  }

  const value = raw.trim()
  const [y, m, d] = value.split('-').map(Number)
  const asUtc = Date.UTC(y, m - 1, d)
  const parsed = new Date(asUtc)

  // Fanger opp datoer som ikke finnes (31. februar blir 3. mars i JS).
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    return { ok: false, error: 'Oppgi en gyldig dato.' }
  }

  const todayUtc = utcMidnight(now)
  const diffDays = Math.round((asUtc - todayUtc) / 86_400_000)

  if (diffDays < MIN_DAYS_AHEAD) {
    // «Fjern nå» finnes allerede som egen handling — en plan for i dag eller
    // tidligere er enten en skrivefeil eller en misforståelse av knappen.
    return { ok: false, error: 'Velg en dato fram i tid. Skal medlemmet fjernes nå, bruk «Fjern».' }
  }

  const maxUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + MAX_MONTHS_AHEAD,
    now.getUTCDate(),
  )
  if (asUtc > maxUtc) {
    return { ok: false, error: `Datoen kan maks være ${MAX_MONTHS_AHEAD} måneder fram i tid.` }
  }

  return { ok: true, at: new Date(asUtc).toISOString() }
}

/** «2. august 2026» — brukt i bekreftelsesmodal, panel-liste og logg. */
export function formatRemovalDate(iso: string): string {
  return new Date(iso).toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
