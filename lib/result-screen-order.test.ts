// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: at PLASSERINGEN står FØR kategoriblokken på
// resultatskjermen i app/quiz/[id]/page.tsx — for BEGGE varianter.
//
// ── HVORFOR DEN FINNES ──────────────────────────────────────────────────────
// Fram til 29. august 2026 sto kategoriblokken («Kategorier», én rad per
// kategori) rett under score-heroen, altså MELLOM score og plassering. På en
// quiz med ni kategorier begravde den plasseringen under en scrollflate —
// mest merkbart på arkivspill, der spøkelsesplasseringen («Slik ville du
// havnet den uken») er hele grunnen til at man spilte runden.
//
// Kategoriblokken er ÉN blokk, felles for begge variantene (det finnes ingen
// egen arkiv-render — arkiv og fredag deler samme `return (`, og skiller seg
// bare ved at enkelte blokker rendrer null). Derfor skapte den ene blokken
// begge symptomene, og derfor er dette ÉN flytt — men to rekkefølger å felle.
//
// ── HVORFOR KILDETEKST-TEST ─────────────────────────────────────────────────
// Samme grunn som lib/archive-ranking-wiring.test.ts og
// lib/dead-session-finish-wiring.test.ts: npm test kjører kun lib/**/*.test.ts
// under Node sin egen runner — ingen jsdom, ingen React-rendering. Rekkefølgen
// på JSX-blokker i en 5000-linjers klientkomponent kan derfor ikke felles ved
// å rendre; den felles ved å lese kilden.
//
// Det denne filen IKKE beviser: at blokkene faktisk er synlige, eller hvordan
// de ser ut. Den beviser dokument-rekkefølgen i JSX-en, som er det som
// bestemmer visuell rekkefølge i en vanlig blokk-layout (ingen `order:`,
// ingen `flex-direction: column-reverse` i veien — resultatpanelet er en
// vanlig strøm).
//
// ── ANKERVALG ───────────────────────────────────────────────────────────────
// Ankrene er BESLUTNINGSPUNKTET i hver blokk, ikke en overskrift: gates og
// beregninger flytter seg sammen med blokken sin, mens en overskrift kan
// dupliseres eller gjenbrukes av en nabo. Hvert anker assertes UNIKT, slik at
// en ny kopi av en blokk ikke kan oppfylle rekkefølgen på vegne av originalen
// (se `feedback-nearby-code-can-satisfy-your-test-anchor`).
//
// Kilden strippes for kommentarer FØR søk. Uten det ville
// «── Spøkelsesplasseringen — «slik ville du havnet den uken» ──»-kommentaren
// over arkivblokken kunne oppfylle et anker som var kommentert ut, og en
// utkommentert blokk ville sett levende ut
// (se `feedback-structural-tests-need-active-line-anchors`).
//
// MUTASJONSBEVIS — konkrete feilendringer denne filen fanger:
//   • Flyttes kategoriblokken tilbake mellom score og plassering → begge
//     rekkefølgetestene ryker.
//   • Flyttes den tilbake bare forbi arkivplasseringen (og blir stående foran
//     fredagsplasseringen) → fredagstesten ryker alene. Det er hele poenget
//     med to separate assertions: ÉN blokk, men to variantstier.
//   • Kommenteres en av blokkene ut i stedet for å slettes → unikhetstesten
//     for det ankeret ryker (kommentarer strippes).
//   • Limes kategoriblokken inn en gang til på toppen uten å fjerne den
//     nederst → unikhetstesten ryker.
//   • Flyttes divideren tilbake over kategoriblokken sin gamle plass →
//     divider-testen ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const RÅ = readFileSync('app/quiz/[id]/page.tsx', 'utf8')

/**
 * Fjerner blokk-kommentarer (`/* … *\/`, som også dekker JSX-formen
 * `{/* … *\/}`) og linje-kommentarer (`// …`), slik at ankersøkene kun treffer
 * AKTIV kode. Erstatter med like mange linjeskift som den fjernede teksten
 * hadde, så indeksene i den strippede kilden fortsatt er monotone med
 * originalens — rekkefølge er alt denne filen sammenligner.
 */
function utenKommentarer(kilde: string): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
}

const SRC = utenKommentarer(RÅ)

/** Indeksen til ankeret, med krav om at det finnes NØYAKTIG én gang. */
function unikIndeks(anker: string, hva: string): number {
  const første = SRC.indexOf(anker)
  assert.notEqual(
    første, -1,
    `fant ikke ${hva} — ankeret «${anker}» finnes ikke i aktiv kode i page.tsx. ` +
    `Er blokken omskrevet? Oppdater ankeret, ikke slett testen.`,
  )
  assert.equal(
    SRC.indexOf(anker, første + 1), -1,
    `${hva}: ankeret «${anker}» finnes FLERE steder. En kopi kan da oppfylle ` +
    `rekkefølgen på vegne av originalen — velg et anker som skiller.`,
  )
  return første
}

// ── Ankrene ────────────────────────────────────────────────────────────────
// Arkiv: hele spøkelsesplasseringen henger på denne ene gaten. Det er den
// ENESTE `{isArchive && (() => {` i fila — de andre arkiv-vilkårene på
// resultatskjermen er `!isArchive`.
const ANKER_ARKIV_PLASSERING = '{isArchive && (() => {'
// Fredag: «Din plassering»-kortet mot den åpne topplisten. Beslutningen om
// hvem som ser hva tas her. Overskriften «Din plassering» duger IKKE som
// anker — org-kortet lenger oppe sier «Din plassering hos {orgName}».
const ANKER_FREDAG_PLASSERING = 'decideResultPlacementView({'
// Kategoriene: selve beregningen. Importlinja bruker en annen form
// (`import { computeCategoryStats } from …`), så kallet med argumenter er unikt.
const ANKER_KATEGORIER = 'computeCategoryStats(answers, questions)'

test('arkiv: spøkelsesplasseringen kommer FØR kategoriblokken', () => {
  const plassering = unikIndeks(ANKER_ARKIV_PLASSERING, 'arkivets spøkelsesplassering')
  const kategorier = unikIndeks(ANKER_KATEGORIER, 'kategoriblokken')
  assert.ok(
    plassering < kategorier,
    'Kategoriblokken står foran spøkelsesplasseringen på resultatskjermen. ' +
    'Etter et arkivspill er plasseringen mot det frosne feltet hele grunnen ' +
    'til at runden ble spilt — den skal ikke ligge under ni kategorirader.',
  )
})

test('fredag: «Din plassering» kommer FØR kategoriblokken', () => {
  const plassering = unikIndeks(ANKER_FREDAG_PLASSERING, 'fredagsquizens plasseringskort')
  const kategorier = unikIndeks(ANKER_KATEGORIER, 'kategoriblokken')
  assert.ok(
    plassering < kategorier,
    'Kategoriblokken kiler seg inn mellom score og plassering på fredagsquizen. ' +
    'Score og plassering skal stå som ett sammenhengende par øverst.',
  )
})

test('kategoriblokken ligger etter BEGGE plasseringsstiene, ikke bare den ene', () => {
  // Den samme ene blokken betjener begge variantene. Flyttes den bare forbi
  // den ene plasseringen, er halve problemet fortsatt der — og en test som
  // kun så på én variant ville meldt grønt.
  const arkiv = unikIndeks(ANKER_ARKIV_PLASSERING, 'arkivets spøkelsesplassering')
  const fredag = unikIndeks(ANKER_FREDAG_PLASSERING, 'fredagsquizens plasseringskort')
  const kategorier = unikIndeks(ANKER_KATEGORIER, 'kategoriblokken')
  assert.ok(
    kategorier > Math.max(arkiv, fredag),
    'Kategoriblokken må ligge etter den SISTE av de to plasseringsblokkene. ' +
    `Nå: arkiv=${arkiv}, fredag=${fredag}, kategorier=${kategorier}.`,
  )
})

test('divideren følger kategoriblokken ned — ikke stående mellom score og plassering', () => {
  // Divideren markerte «slutt på score-delen». Blir den stående der den var,
  // skjærer den tvers gjennom paret score+plassering som flyttingen skulle
  // binde sammen. Den skal nå skille paret fra resten av skjermen.
  const fredag = unikIndeks(ANKER_FREDAG_PLASSERING, 'fredagsquizens plasseringskort')
  const kategorier = unikIndeks(ANKER_KATEGORIER, 'kategoriblokken')
  const divider = SRC.indexOf('className="qk-divider"', fredag)
  assert.notEqual(
    divider, -1,
    'fant ingen qk-divider etter plasseringsblokken — er den slettet eller flyttet opp igjen?',
  )
  assert.ok(
    divider < kategorier,
    'Divideren skal stå mellom plasseringen og kategoriene, ikke etter kategoriene.',
  )
})
