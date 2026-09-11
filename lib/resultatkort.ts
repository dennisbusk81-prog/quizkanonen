// ── Resultatkortet — hvem som havner på de tre utheva kortene ────────────────
//
// Ren logikk, ingen I/O. Kalles fra app/admin/resultatkort/[quizId]/route.ts,
// som har hentet FELTET via `getPublicSnapshot` (lib/public-snapshot.ts) og
// derfor allerede har den kanoniske rangeringen: flest riktige, så raskest tid,
// så flest riktige på rad — med blokkerte brukere fjernet og posisjonell
// re-rank. Denne filen skal ALDRI sortere feltet på nytt. Den plukker bare ut
// tre spillere og de ti øverste.
//
// Plasseringen «midt i feltet» peker på eies heller ikke her — den kommer fra
// lib/midt-i-feltet.ts, delt med delingsteksten og admin sin resultatside.
// Fram til 11. september 2026 regnet denne fila den ut selv, med en annen
// formel enn de to andre, og bildet og teksten i samme Facebook-innlegg kunne
// derfor oppgi hvert sitt navn på samme plass ved partall deltakere.
//
// ── HVORFOR IKKE EN NY SORTERINGSRUTINE ────────────────────────────────────
// Kortet erstatter skjermbildet Dennis i dag tar av den offentlige
// resultatlisten. Hadde det hatt sin egen sortering, kunne bildet og siden
// pekt ut hver sin vinner — nøyaktig den divergensen kommentaren i
// lib/ranking.ts:73-85 ble skrevet om. Feltet kommer inn ferdig rangert og
// brukes i den rekkefølgen det kom.

import { midtPlassering } from './midt-i-feltet'

/** Én spiller i det ferdig rangerte, synlige feltet. */
export interface KortSpiller {
  /** Plassering i det synlige feltet — 1-basert, unik, uten hull. */
  rank: number
  navn: string
  riktige: number
  totalTidMs: number
}

export interface Resultatkort {
  vinner: KortSpiller
  raskest: KortSpiller
  /** null når feltet er for lite, eller når kortet ville gjentatt et navn. */
  midten: KortSpiller | null
  /** De ti øverste — kortere når feltet er kortere. */
  topp10: KortSpiller[]
  /** HELE feltet, ikke lengden på `topp10`. */
  deltakere: number
}

/**
 * Under dette antallet vises ikke «midt i feltet»-kortet.
 *
 * Med fire deltakere er «midten» andreplass, og kortet sier da noe alle
 * allerede ser på lista rett under. Grensen er bestillingens egen (N < 5).
 *
 * BEVISST STRENGERE enn `MIN_FELT_FOR_MIDTEN` (3) i lib/midt-i-feltet.ts, og
 * de to skal ikke slås sammen: den ene sier om DETTE FORMATET skal tegne et
 * kort, den andre om «midten» er et meningsfullt begrep i det hele tatt. Ved
 * N=3 og N=4 oppgir delingsteksten derfor en midtmann som bildet utelater —
 * det er tilsiktet. Plasseringen de to ville pekt på er den samme.
 */
export const MIN_DELTAKERE_FOR_MIDTEN = 5

/**
 * Den raskeste i feltet — laveste `totalTidMs`, uansett antall riktige.
 *
 * Ved helt lik tid vinner den som står best an på lista fra før (laveste
 * rank). Det gjør valget deterministisk: to spillere med identisk tid skal
 * ikke bytte plass på kortet mellom to renderinger av samme quiz.
 */
function finnRaskest(felt: readonly KortSpiller[]): KortSpiller {
  return felt.reduce((best, kandidat) => {
    if (kandidat.totalTidMs !== best.totalTidMs) {
      return kandidat.totalTidMs < best.totalTidMs ? kandidat : best
    }
    return kandidat.rank < best.rank ? kandidat : best
  })
}

/**
 * Bygg kortmodellen fra et ferdig rangert, synlig felt.
 *
 * Returnerer null for et tomt felt — kalleren skal da svare med en ekte feil
 * i stedet for å rendre et bilde uten innhold.
 */
export function byggResultatkort(felt: readonly KortSpiller[]): Resultatkort | null {
  if (felt.length === 0) return null

  const deltakere = felt.length
  const vinner = felt[0]
  const raskest = finnRaskest(felt)

  // `rank` er posisjonell og unik i det synlige feltet (se getPublicSnapshot:
  // gjenværende re-rankes til 1..N uten hull), så likhet på rank ER identitet.
  // Ingen id-sammenligning nødvendig.
  let midten: KortSpiller | null = null
  const plass = midtPlassering(deltakere)
  if (plass !== null && deltakere >= MIN_DELTAKERE_FOR_MIDTEN) {
    const kandidat = felt[plass - 1] ?? null
    // Vinneren kan aldri kollidere her — ceil(N/2) >= 3 når N >= 5 — men den
    // raskeste kan godt ligge midt i feltet. Da droppes kortet heller enn å
    // trykke samme navn to ganger på rad ved siden av hverandre.
    midten = kandidat && kandidat.rank !== vinner.rank && kandidat.rank !== raskest.rank
      ? kandidat
      : null
  }

  return { vinner, raskest, midten, topp10: felt.slice(0, 10), deltakere }
}

/**
 * Tid slik resten av plattformen skriver den.
 *
 * Samme form som `defaultFormatTime` i components/ResultsTable.tsx:110 og
 * `formatTime` i components/SeasonLeaderboard.tsx:176 — altså den tiden som
 * står i lista Dennis fotograferer i dag. Kortet skal ikke innføre en tredje
 * skrivemåte (`m:ss`-formen i quiz-results-text er den andre).
 */
export function formatTid(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Dato-delen av filnavnet: ÅÅÅÅ-MM-DD i norsk tid.
 *
 * Europe/Oslo og ikke UTC, fordi en quiz som stenger 20:00 norsk tid i
 * sommertid er 18:00 UTC samme dag — men en quiz som stenger 00:30 ville
 * fått gårsdagens dato i UTC. Filnavnet skal matche dagen Dennis publiserer.
 */
export function filnavnDato(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date()
  const gyldig = Number.isNaN(d.getTime()) ? new Date() : d
  const deler = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(gyldig)
  const finn = (type: string) => deler.find(p => p.type === type)?.value ?? '00'
  return `${finn('year')}-${finn('month')}-${finn('day')}`
}
