// ── Kanonkule-kortet på forsiden: de RENE tekstreglene ──────────────────────
//
// Bygget 8. september 2026 (kveld) sammen med components/KanonkulerCard.tsx.
// Ingen I/O og ingen React — kortet regner ingenting selv, det viser det som
// avgjøres her. Da kan hver tekst-tilstand testes som en tabell
// (lib/kanonkuler-tekst.test.ts), og entall/flertall er én funksjon.
//
// ── TALLET VISES TIL BEGGE, MEN MED ULIKT FORTEGN (Dennis, bestillingen) ────
//   gratis                  forbruk:     «2 kanonkuler igjen»
//   premium, ingen brukt    tildeling:   «30 kanonkuler denne måneden»
//   premium, noen brukt     forbruk:     «8 kanonkuler igjen» (som gratis)
//
// Begrunnelsen, så den ikke forsvinner: gratisbrukerens knapphet er selve
// produktmekanikken og skal føles. Premium-brukeren skal se hva hun HAR, ikke
// hva hun har tært på — men et tak som finnes og aldri vises, er en vegg som
// kommer fra ingensteds den dagen hun når det.
//
// TILDELINGSPÅSTANDEN STÅR BARE SÅ LENGE DEN ER HEL (Dennis, andre runde
// samme kveld). Første utkast viste «25 kanonkuler denne måneden» etter fem
// brukt, med en terskel på ti før teksten byttet til «igjen». «25 … denne
// måneden» leser som en tildeling på 25 — usant. Nå bytter teksten ved
// FØRSTE brukte kule, ikke ved en terskel — til den samme forbrukslinja som
// gratis har (tredje runde: substantivet inn, «denne måneden» ut).
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
  | { kind: 'tildeling'; text: string }
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

  // Hel tildeling (ingen brukt) → tildelingspåstanden. Én brukt → forbruk,
  // samme linje som gratis.
  if (plan === 'premium' && remaining >= GENERATION_QUOTA.premium) {
    return { kind: 'tildeling', text: `${remaining} ${kanonkuleOrd(remaining)} denne måneden` }
  }

  return { kind: 'igjen', text: `${remaining} ${kanonkuleOrd(remaining)} igjen` }
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
 * den sammen selv. Quizens EGEN tittel (GENERATED_QUIZ_TITLE, «Tilfeldig
 * quiz») er uendret — det er kortet som heter noe annet, ikke quizen.
 * «Femten» er skrevet som ord og bindes til GENERATED_QUIZ_QUESTION_COUNT av
 * en test, som «to» over (femte runde: ordlyden byttet, bindingen står).
 */
export const KANONKULER_EYEBROW = 'Ekstraquiz'
export const KANONKULER_TITLE = 'Lag en ny quiz'
export const KANONKULER_BODY_TEXT =
  'Femten tilfeldige spørsmål fra Quizkanonens spørsmålsbank. Koster én kanonkule og gir ingen poeng på topplistene. Bare for gøy og trening.'

/**
 * Oppsalgslinja for GRATIS MED KULER IGJEN, rett under statuslinja. En
 * gratisbruker som bruker null eller én kule i måneden når aldri tom-skjermen,
 * og ser derfor aldri at Premium gir mer. Tekstlenke til /premium — ikke
 * knapp, ikke gull. Premium ser den aldri; gratis med null kuler heller ikke
 * (der står oppsalget allerede i tom-teksten).
 */
export const KANONKULER_FREE_UPSELL_LINE =
  `Med Premium: ${GENERATION_QUOTA.premium} kanonkuler i måneden og valgfri kategori →`
