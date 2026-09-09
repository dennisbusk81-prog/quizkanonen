// ── Kanonkule-kortet på forsiden: de RENE tekstreglene ──────────────────────
//
// Bygget 8. september 2026 (kveld) sammen med components/KanonkulerCard.tsx.
// Ingen I/O og ingen React — kortet regner ingenting selv, det viser det som
// avgjøres her. Da kan hver tekst-tilstand testes som en tabell
// (lib/kanonkuler-tekst.test.ts), og entall/flertall er én funksjon.
//
// ── STATUSLINJA ER FELLES FOR BEGGE PLANER (Dennis, sjette runde 8. sept.) ──
//   N > 0   «Du har N kanonkuler igjen denne måneden»
//   N = 1   «Du har 1 kanonkule igjen denne måneden»
//   N = 0   «Neste kanonkule 1. oktober»
//
// Historikken, så den ikke gjentas: første utkast skilte planene («2
// kanonkuler igjen» for gratis, «30 kanonkuler denne måneden» for premium,
// med en terskel på ti før premium byttet til «igjen»). «25 kanonkuler denne
// måneden» etter fem brukt leste som en tildeling på 25 — usant — så
// terskelen gikk ut, og tildelingslinja sto kun ved hel kvote. I sjette runde
// utgikk tildelingslinja helt: premium og gratis deler nå samme streng, og
// det finnes ingen gren på plan i statuslinja lenger. Taket er synlig for
// begge gjennom tallet selv.
//
// ── TOMT FOR KULER ER EN SALGSFLATE, IKKE EN FEILMELDING ────────────────────
//   gratis:   «Neste kanonkule 1. oktober · Få 30 med Premium og velg kategori»
//   premium:  «Neste kanonkule 1. oktober»
// En premium-bruker som har brukt opp de tretti skal IKKE se et tilbud om å
// kjøpe det hun allerede har — samme feilklasse som «Reaktiver Premium» på
// en konto som aldri har hatt det. `upsell` er derfor null for premium, ikke
// en tom streng noen kan glemme å sjekke.
//
// Tallene kommer fra GENERATION_QUOTA — teksten gjentar dem ikke.
import { GENERATION_QUOTA, type GenerationPlan } from '@/lib/generated-quiz-rules'

/** «1 kanonkule», «2 kanonkuler». Prosjektet har hatt «1 quizer totalt» før. */
export function kanonkuleOrd(n: number): string {
  return n === 1 ? 'kanonkule' : 'kanonkuler'
}

/**
 * Kuler igjen denne måneden. Klemmes til 0: senkes kvoten etter at noen
 * har brukt mer enn den nye grensen, er svaret «tom», ikke et negativt tall.
 */
export function kanonkulerRemaining(plan: GenerationPlan, usedThisMonth: number): number {
  return Math.max(0, GENERATION_QUOTA[plan] - usedThisMonth)
}

export type KanonkulerStatus =
  | { kind: 'igjen'; text: string }
  | { kind: 'tom'; text: string; upsell: string | null }

/**
 * Statuslinja på kortet. `nextMonthLabel` er «1. oktober» fra
 * osloNextMonthStartLabel (lib/oslo-time.ts) — første dag i neste norske
 * kalendermåned, som er dagen kvoten fylles opp igjen.
 */
export function kanonkulerStatus(input: {
  plan: GenerationPlan
  remaining: number
  nextMonthLabel: string
}): KanonkulerStatus {
  const { plan, remaining, nextMonthLabel } = input

  if (remaining <= 0) {
    return {
      kind: 'tom',
      text: `Neste kanonkule ${nextMonthLabel}`,
      upsell: plan === 'free'
        ? `Få ${GENERATION_QUOTA.premium} med Premium og velg kategori`
        : null,
    }
  }

  // Samme streng for begge planer — ingen gren på plan her (se filhodet).
  return { kind: 'igjen', text: `Du har ${remaining} ${kanonkuleOrd(remaining)} igjen denne måneden` }
}

/**
 * Bekreftelsessteget for GRATIS (premium går rett gjennom — med tretti er
 * friksjonen bare i veien). Å bruke halve månedskvoten på et feiltrykk er en
 * ekte skade når du har to. Ordlyden er Dennis' (bestillingen 8. september);
 * «to» er skrevet ut som ord, og testen binder det til GENERATION_QUOTA.free.
 */
export const KANONKULER_FREE_CONFIRM_TEXT = 'Dette bruker én av to kanonkuler.'

/**
 * Kortets faste tekster (Dennis, ordrett, 8. september 2026 — fjerde runde).
 * Etiketten sier hva kortet ER, ikke hva det koster: «Kanonkuler» er
 * valutaen, ikke tingen. «Din egen quiz» ble droppet fordi hun ikke setter
 * den sammen selv — og «Lag» gikk ut av samme grunn (runde 7, 9. september):
 * ordet leser som at hun skriver spørsmålene. Quizens EGEN tittel (GENERATED_QUIZ_TITLE, «Tilfeldig
 * quiz») er uendret — det er kortet som heter noe annet, ikke quizen.
 * «Femten» er skrevet som ord og bindes til GENERATED_QUIZ_QUESTION_COUNT av
 * en test, som «to» over (femte runde: ordlyden byttet, bindingen står).
 */
export const KANONKULER_EYEBROW = 'Ekstraquiz'
export const KANONKULER_TITLE = 'Generer en ny quiz'
/** Knappen. «Generer», ikke «lag»: hun skriver ikke spørsmålene selv — quizen trekkes fra spørsmålsbanken (Dennis, 9. september 2026). */
export const KANONKULER_BUTTON = 'Generer quiz'
export const KANONKULER_BODY_TEXT =
  'Femten tilfeldige spørsmål, trukket fra tusenvis i Quizkanonens spørsmålsbank. Koster én kanonkule og gir ingen poeng på topplistene. Bare for gøy og trening.'

/**
 * Oppsalgslinja for GRATIS MED KULER IGJEN, rett under statuslinja. En
 * gratisbruker som bruker null eller én kule i måneden når aldri tom-skjermen,
 * og ser derfor aldri at Premium gir mer. Tekstlenke til /premium — ikke
 * knapp, ikke gull. Premium ser den aldri; gratis med null kuler heller ikke
 * (der står oppsalget allerede i tom-teksten).
 */
export const KANONKULER_FREE_UPSELL_LINE =
  `Med Premium: ${GENERATION_QUOTA.premium} kanonkuler i måneden, og du velger kategori →`
