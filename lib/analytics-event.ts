// ── Traktmåling: den RENE beslutningen om hva som får forlate klienten ───────
//
// Delt i to filer av samme grunn som lib/premium-state.ts / premium-state-io.ts
// og lib/answer-key-correction.ts / resync-season-scores.ts: beslutningen er
// verdt å teste for seg, uavhengig av sinket den kalles fra. Denne filen kjenner
// ikke @vercel/analytics — lib/analytics.ts er sinket, og det ENESTE stedet
// track() kalles.
//
// ── HVORFOR EN HVITELISTE PÅ BÅDE NØKLER OG VERDIER ────────────────────────
// Kravet er at ingen property skal kunne peke tilbake på én person. Den
// billigste måten å garantere det på er ikke å lete etter forbudte felt
// (user_id, e-post, quiz-id, poengsum, plassering …) — en svarteliste må
// utvides hver gang noen finner på et nytt felt, og glemmer man det er feilen
// den STILLE typen. I stedet BYGGES properties-objektet fra bunnen av her, av
// verdier som alle kommer fra lukkede, hardkodede sett:
//
//   nøkler  ∈ { 'tilgang', 'bredde' }
//   tilgang ∈ TILGANG_VERDIER   (4 verdier)
//   bredde  ∈ BREDDE_BOTTER     (4 verdier)
//
// Ingenting fra kalleren kopieres videre — det finnes ingen spread. En kaller
// KAN derfor ikke lekke et felt, heller ikke ved et uhell, heller ikke i
// framtiden. Samme grep som `buildAccessCode()` som erstattet `insert(body)`
// (mass assignment, 26. juli 2026), og samme prinsipp som escapingen i
// lib/email-templates.ts og scrubEvent() i lib/sentry-scrub.ts: vakten bor ved
// SINKET, ikke hos kallerne.
//
// Konsekvensen er at «ingen forbudt property slipper gjennom» kan bevises ved
// UTTØMMING i test, i stedet for å sannsynliggjøres med noen stikkprøver.
//
// ── TAKET PÅ TO PROPERTIES ER EN PLANGRENSE, IKKE EN SMAKSSAK ──────────────
// Vercel Web Analytics på Pro (grunnversjonen, uten Web Analytics Plus) tillater
// nøyaktig 2 properties per custom event; Plus hever til 8.
// Kilde: https://vercel.com/docs/analytics/limits-and-pricing (tabellraden
// «Properties on Custom Events»), verifisert 26. august 2026.
// `quiz_startet` bruker begge (tilgang + bredde). Det er ingen plass igjen: en
// tredje property krever Plus-tillegget, ikke bare en ny linje her.
// MAKS_PROPERTIES under er låst med test nettopp fordi et slikt tak ellers
// drifter i stillhet — Vercel dropper det overskytende uten å feile høylytt.

import { REAL_QUIZ_TYPES, erEkteQuiz } from './real-quiz-population'

/** Vercel Pro (grunnversjon): 2 properties per custom event. Se kommentaren over. */
export const MAKS_PROPERTIES = 2

/**
 * De fire hendelsene. Sidevisninger dekkes automatisk av Web Analytics og skal
 * IKKE dupliseres her — hver hendelse koster (Pro har ingen inkluderte events;
 * $30 per ekstra 1M events).
 */
export const ANALYTICS_HENDELSER = [
  'quiz_startet',
  'quiz_fullfort',
  'premium_cta_vist',
  'premium_cta_klikk',
] as const
export type AnalyticsHendelse = typeof ANALYTICS_HENDELSER[number]

/**
 * Grov tilgangsbøtte. Bevisst uten enhver form for identitet: dette er den
 * eneste dimensjonen trakten skal kunne brytes ned på.
 */
export const TILGANG_VERDIER = ['uinnlogget', 'gratis', 'premium', 'org'] as const
export type Tilgang = typeof TILGANG_VERDIER[number]

/**
 * Skjermbredde som BØTTE, aldri råtallet. Et råtall er en smalere identifikator
 * enn det ser ut som (en uvanlig viewport-bredde kan peke på én enhet), og
 * spørsmålet vi faktisk skal svare på er grovkornet: er QuizInterlude-saken på
 * 360px verdt å fikse?
 */
export const BREDDE_BOTTER = ['<400', '400-767', '768-1023', '>=1024'] as const
export type BreddeBotte = typeof BREDDE_BOTTER[number]

/**
 * Minimumsformen vi trenger av quizen for å avgjøre om den er ekte.
 * Klienten henter quizen med `select('*')` (app/quiz/[id]/page.tsx:1265), så
 * begge feltene ligger allerede i state — ingen ekstra spørring, ingen latens.
 */
export type AnalyticsQuizMeta = {
  is_test?: boolean | null
  quiz_type?: string | null
} | null | undefined

export type SporingsInput = {
  hendelse: AnalyticsHendelse
  /** Quizen hendelsen gjelder. Ukjent quiz ⇒ ingen hendelse (se under). */
  quiz: AnalyticsQuizMeta
  tilgang: Tilgang
  /** window.innerWidth. Leses KUN for quiz_startet — se taket på 2 properties. */
  vindusbredde?: number | null
}

export type Sporingsbeslutning =
  | { send: false; grunn: 'ukjent-hendelse' | 'ukjent-tilgang' | 'ukjent-quiz' | 'kunstig-quiz' }
  | { send: true; navn: AnalyticsHendelse; properties: Record<string, string> }

/**
 * window.innerWidth → bøtte.
 *
 * Alt som ikke er et endelig, positivt tall gir `null`, og da UTELATES
 * property-en helt i stedet for å sende en oppdiktet bøtte. Serverside-render
 * (ingen `window`), en gammel nettleser, NaN fra en rar embed — alle skal gi
 * «vet ikke», aldri «<400». En falsk 360px-måling ville pekt rett på den ene
 * beslutningen denne målingen finnes for.
 */
export function bottleggBredde(bredde: number | null | undefined): BreddeBotte | null {
  if (typeof bredde !== 'number' || !Number.isFinite(bredde) || bredde <= 0) return null
  if (bredde < 400) return '<400'
  if (bredde < 768) return '400-767'
  if (bredde < 1024) return '768-1023'
  return '>=1024'
}

/**
 * Utleder tilgangsbøtta fra det ProfileProvider allerede har i minnet.
 *
 * ⚠ `premiumSource` er profiles.premium_source, som CLAUDE.md er tydelig på KUN
 * er en CACHE — og den bærer ÉN kilde selv om en bruker reelt kan ha flere
 * samtidig (kode + org + Stripe). En org-bruker som også har personlig
 * abonnement kan derfor havne i 'premium' i stedet for 'org'.
 *
 * Det er akseptert med vilje, og forbeholdet står her framfor at vi bygger en
 * ny utledning: den autoritative veien er `decidePremiumState()`, som er I/O.
 * Å legge et databaseoppslag i spillestien for en analytics-ETIKETT ville vært
 * å betale den varmeste stien i produktet for en visningsdetalj. Invarianten
 * fra CLAUDE.md er dessuten intakt: cache-feltene skal ikke styre BESLUTNINGER
 * — dette er en bøtte i en trakt, ikke en gating.
 */
export function utledTilgang(input: {
  isLoggedIn: boolean
  isPremium: boolean
  premiumSource: string | null | undefined
}): Tilgang {
  if (!input.isLoggedIn) return 'uinnlogget'
  if (!input.isPremium) return 'gratis'
  return input.premiumSource === 'org' ? 'org' : 'premium'
}

/**
 * Avgjør om hendelsen skal sendes, og bygger i så fall det EKSAKTE
 * properties-objektet som får forlate klienten.
 *
 * ── HVORFOR UKJENT QUIZ GIR «IKKE SEND» ────────────────────────────────────
 * Kravet er absolutt: er quizen `is_test`, sendes ingen hendelse. Vet vi ikke
 * hva slags quiz det er, vet vi heller ikke at den IKKE er en testquiz — og da
 * er den eneste tolkningen som holder kravet å la være å sende. Retningen er
 * valgt bevisst: en uteblitt hendelse gjør trakten litt tynnere, mens en
 * testquiz som slipper inn forurenser tallene UTEN å etterlate spor man kan
 * finne igjen etterpå.
 *
 * I praksis er grenen uoppnåelig fra dagens fire kallsteder: alle fire ligger
 * på flater som krever at quizen allerede er lastet.
 */
export function decideAnalyticsEvent(input: SporingsInput): Sporingsbeslutning {
  // Begge sjekkene er runtime-vakter, ikke bare typetro. Kallstedene er
  // TypeScript, men helperen er den eneste porten og skal ikke stole på at
  // enhver framtidig kaller er det.
  if (!(ANALYTICS_HENDELSER as readonly string[]).includes(input.hendelse)) {
    return { send: false, grunn: 'ukjent-hendelse' }
  }
  if (!(TILGANG_VERDIER as readonly string[]).includes(input.tilgang)) {
    return { send: false, grunn: 'ukjent-tilgang' }
  }

  // «Ukjent quiz» er BEGGE feltene fraværende. Ett felt holder: en quiz med
  // `quiz_type: 'weekly'` og `is_test` utelatt er kjent nok — `erEkteQuiz`
  // speiler da PostgREST-semantikken (`.not(is_test, is, true)` dekker både
  // false og NULL). Krevde vi begge, ville en normal quiz-rad uten `is_test`
  // stille sluttet å telle.
  const quiz = input.quiz
  if (!quiz || (quiz.is_test == null && quiz.quiz_type == null)) {
    return { send: false, grunn: 'ukjent-quiz' }
  }
  if (!erEkteQuiz(quiz)) {
    return { send: false, grunn: 'kunstig-quiz' }
  }

  // ── Bygges fra bunnen. Ingen spread, ingen kopiering fra kalleren. ────────
  const properties: Record<string, string> = { tilgang: input.tilgang }

  // `bredde` KUN på quiz_startet — det er den ene hendelsen der spørsmålet
  // «hvilke skjermstørrelser brukes» faktisk stilles, og taket er 2.
  if (input.hendelse === 'quiz_startet') {
    const botte = bottleggBredde(input.vindusbredde)
    if (botte) properties.bredde = botte
  }

  return { send: true, navn: input.hendelse, properties }
}

// Re-eksporteres for testens skyld: at bøtta for «ekte quiz» er DEN SAMME
// hvitelisten resten av kodebasen rangerer på, er en påstand som skal kunne
// felles hvis noen lager en kopi her.
export { REAL_QUIZ_TYPES }
