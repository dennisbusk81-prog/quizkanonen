// ── Spøkelsesplasseringen på resultatskjermen: klientens RENE tolkning ───────
//
// Bygget 27. august 2026 ([ARK-1] steg 1C, klientflaten). Serveren
// (app/api/arkiv/[id]/plassering) skiller tre «ingen plassering»-grunner —
// ingen-kilde, tomt-felt, lagforsok — men skillet finnes FOR LOGGENS SKYLD,
// ikke for spilleren: alle tre skal vises identisk (Dennis-retning
// 27. august). Kollapsen bor derfor her, i én testbar funksjon, i stedet for
// som tre tekstgrener i resultatskjermens JSX der en framtidig endring kunne
// gitt én av grunnene sin egen ordlyd.
//
// «Ingen plassering finnes» er en FØRSTEKLASSES TILSTAND, ikke en feil — den
// er normalen for genererte og importerte arkivquizer. 'feil' er noe annet:
// «vet ikke», og skal aldri vises som «ingen plassering» (samme skille som
// lib/has-settled-plays.ts gjør for spillehistorikk).
//
// ── NEVNEREN OG selfWasInField ──────────────────────────────────────────────
// `total` betyr to ulike ting, og teksten skal si hvilket (se
// lib/archive-placement.ts, «FELLE 2»):
//   selfWasInField=true  → spilleren spilte originalen den fredagen; hennes
//                          gamle rad er trukket ut og `total` er NØYAKTIG det
//                          originale deltakertallet.
//   selfWasInField=false → hun var ikke med; `total` er originalfeltet + 1
//                          (henne selv, lagt til).
// Begge er sanne utsagn om «slik ville du havnet» — men de er ULIKE utsagn,
// og forskjellen skal ikke skjules bak samme setning.

export type ArchivePlacement = {
  rank: number
  total: number
  selfWasInField: boolean
  scope: 'org' | 'global'
}

export type ArchivePlacementView =
  | ({ kind: 'plassering' } & ArchivePlacement)
  /** Ingen-kilde, tomt-felt og lagforsok — bevisst IKKE skilt fra hverandre. */
  | { kind: 'ingen' }
  /** «Vet ikke» — nettverks-/serverfeil. Aldri det samme som 'ingen'. */
  | { kind: 'feil' }

/** Én tekst for alle tre «ingen plassering»-grunnene. */
export const ARCHIVE_NO_FIELD_TEXT =
  'Denne quizen har ikke noe historisk felt å måle mot — resultatet ditt står for seg selv.'

export const ARCHIVE_PLACEMENT_ERROR_TEXT =
  'Vi fikk ikke hentet den historiske plasseringen akkurat nå.'

/**
 * Tolker svaret fra GET /api/arkiv/[id]/plassering. Ren funksjon: (status,
 * parset JSON) inn, visningstilstand ut. `json` er `unknown` fordi svaret kan
 * være hva som helst ved feil — en 503-kropp, null fra en JSON-parse som
 * feilet — og ingen av delene skal kunne kaste her.
 */
export function parseArchivePlacementResponse(
  status: number,
  json: unknown
): ArchivePlacementView {
  if (status !== 200) return { kind: 'feil' }
  if (typeof json !== 'object' || json === null) return { kind: 'feil' }

  const body = json as { placement?: unknown }
  // `placement: null` er serverens «ingen plassering finnes» — reason-feltet
  // ved siden av leses med vilje IKKE: grunnene vises likt.
  if (body.placement === null) return { kind: 'ingen' }

  if (typeof body.placement !== 'object' || body.placement === undefined) {
    return { kind: 'feil' }
  }
  const p = body.placement as {
    rank?: unknown
    total?: unknown
    selfWasInField?: unknown
    scope?: unknown
  }
  // Talljekk, ikke bare truthy: rank/total er det eneste flaten viser, og et
  // manglende felt skal bli «vet ikke» — aldri «NaN. plass av undefined».
  if (typeof p.rank !== 'number' || typeof p.total !== 'number') {
    return { kind: 'feil' }
  }
  return {
    kind: 'plassering',
    rank: p.rank,
    total: p.total,
    selfWasInField: p.selfWasInField === true,
    scope: p.scope === 'org' ? 'org' : 'global',
  }
}

/**
 * Setningene kortet viser. Skilt fra JSX-en så selfWasInField-skillet og
 * scope-merkingen kan felles i test — kortet skal alltid si hvilken scope
 * tallet gjelder (Norge eller bedrift), og hvilken av de to nevner-
 * betydningene som er i spill.
 */
export function archivePlacementText(
  p: ArchivePlacement,
  orgName: string | null
): { kontekst: string; forklaring: string } {
  const hvor =
    p.scope === 'org' ? `hos ${orgName ?? 'bedriften din'}` : 'i hele feltet den uken'
  return {
    kontekst: `av ${p.total} deltakere ${hvor}`,
    forklaring: p.selfWasInField
      ? 'Du deltok også da quizen gikk — denne runden er målt mot det samme feltet, med det gamle resultatet ditt holdt utenfor.'
      : 'Du deltok ikke da quizen gikk — plasseringen viser hvor du ville havnet med denne runden i feltet.',
  }
}
