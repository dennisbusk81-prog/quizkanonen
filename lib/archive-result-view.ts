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

// ── «STÅR I DAG», IKKE «DU FIKK» ────────────────────────────────────────────
// `previous` er spillerens eget gamle resultat på originalquizen — men det er
// en REKONSTRUKSJON, ikke et minne. Den er beviselig lik dagens
// /api/leaderboard/[kilde-id] (samme rankQuizAttempts, samme opsjoner, samme
// blokkert-filter), men to ting kan ha flyttet den siden den fredagen: rader
// kan være slettet (tre hard-delete-ruter, GDPR-sletting inkludert), og
// fasiten kan være rettet (correct-answer skriver om correct_answers).
//
// Setningen sier derfor «står i dag med», ikke «du fikk». Den påstår ikke hva
// hun så — den peker på en liste hun kan åpne og verifisere, og som per
// konstruksjon viser nøyaktig dette tallet. Full begrunnelse og den forkastede
// season_scores-kilden: se ArchivePreviousResult i lib/archive-placement.ts.
//
// NØYTRALT MED VILJE: ingen differanse mot dagens runde, ingen pil, ingen
// fargekoding, ingen påstand om utvikling. Bare tallet. Å regne «3 bedre enn
// sist» ville dessuten målt HUKOMMELSE, ikke ferdighet — samme feilklasse som
// hele spøkelsesplasseringen er bygget for å unngå (se filhodet i
// lib/archive-placement.ts).

import { pluralNo } from './plural-no'

export type ArchivePreviousResultView = {
  rank: number
  correctAnswers: number
}

export type ArchivePlacement = {
  rank: number
  total: number
  selfWasInField: boolean
  /** Eget gamle resultat. null = deltok ikke, ELLER svaret manglet feltet. */
  previous: ArchivePreviousResultView | null
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
    previous?: unknown
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
    previous: parsePrevious(p.previous),
    scope: p.scope === 'org' ? 'org' : 'global',
  }
}

/**
 * `previous` er et TILLEGG, ikke et krav. Mangler eller er ødelagt → null, og
 * kortet viser setningen uten tillegget. Aldri `{ kind: 'feil' }`.
 *
 * Dette er ikke pynt. En fane som sto åpen over deployen har et svar UTEN
 * feltet i det hele tatt; ble det tolket som feil, mistet hun hele
 * plasseringskortet fordi en tilleggssetning manglet. Samme retning som
 * `== null`-regelen for bufrede svar: et gammelt skjema skal degradere, ikke
 * felle flaten.
 */
function parsePrevious(raw: unknown): ArchivePreviousResultView | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as { rank?: unknown; correctAnswers?: unknown }
  // Begge må være tall, ellers vises ingenting: en halv setning («står i dag
  // med undefined riktige») er verre enn ingen setning.
  if (typeof v.rank !== 'number' || typeof v.correctAnswers !== 'number') return null
  return { rank: v.rank, correctAnswers: v.correctAnswers }
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
  if (!p.selfWasInField) {
    return {
      kontekst: `av ${p.total} deltakere ${hvor}`,
      forklaring:
        'Du deltok ikke da quizen gikk — plasseringen viser hvor du ville havnet med denne runden i feltet.',
    }
  }
  // Deltok. Tillegget krever `previous`; mangler det (gammelt svar fra en fane
  // som sto åpen over deployen), står setningen som før — uten tillegg.
  const deltok =
    'Du deltok også da quizen gikk — denne runden er målt mot det samme feltet, med det gamle resultatet ditt holdt utenfor.'
  return {
    kontekst: `av ${p.total} deltakere ${hvor}`,
    forklaring: p.previous
      ? `${deltok} På resultatlisten for den quizen står du i dag med ${p.previous.correctAnswers} ${pluralNo(p.previous.correctAnswers, 'riktig', 'riktige')} og ${p.previous.rank}. plass.`
      : deltok,
  }
}
