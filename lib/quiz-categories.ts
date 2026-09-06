// Kategoriene admin kan velge for et SPØRSMÅL (`questions.category`).
//
// ÉN KILDE, med vilje. Fram til 6. september 2026 lå denne lista hardkodet i
// tre kopier uten felles eier:
//   • app/admin/quizzes/new/page.tsx          (dropdown, ny quiz)
//   • app/admin/quizzes/[id]/questions/page.tsx (dropdown, rediger spørsmål)
//   • app/admin/quizzes/page.tsx               (VALID_CATEGORIES, CSV-import)
//
// De to første er VISNING — glemmes en kategori der, ser admin den bare ikke.
// Den tredje er en DATAPORT: `VALID_CATEGORIES.includes(rawCategory)` i
// CSV-importen setter `category = null` for enhver verdi som ikke står i
// lista, uten feilmelding og uten spor. En kategori lagt til i de to
// dropdown-ene, men glemt i den tredje, gjør altså at et importert bibliotek
// mister kategorien sin stille. Det er den ekte grunnen til at lista bor her
// og ikke tre steder — ikke ryddelighet.
//
// Samme feilklasse som hvitelisten i lib/real-quiz-population.ts, og samme
// mottiltak: én liste, mange lesere.
//
// DATABASEN BEGRENSER INGENTING. `questions.category` er `text NULL` uten
// CHECK-constraint eller enum (kolonnen ble lagt til av
// app/api/admin/migrate-category). Denne konstanten er derfor eneste
// håndhevelse som finnes, og eksisterende rader kan inneholde verdier som
// ikke står her (bl.a. NULL — 4 av 199 spørsmål manglet kategori per 30. juli
// 2026). Lesere som teller eller viser kategorier må tåle det; se
// UNCATEGORIZED_LABEL i lib/category-stats.ts.
//
// REKKEFØLGEN er visningsrekkefølgen i dropdown-ene, og den er en BESLUTNING
// — ikke et resultat av en sortering i kode. Alfabetisk, med «Diverse» tvunget
// sist fordi den er restkategorien man velger når ingen av de andre passet.
// Med fjorten valg er en vilkårlig rekkefølge for lang til å skanne; det ene
// elementet som IKKE flytter seg når lista vokser, er samtidig det mest
// brukte (34 av 199 spørsmål per 2. august 2026).
//
// ÉTT BEVISST AVVIK fra ekte nb-kollasjon: «Språk & Ord» står etter «Sport».
// `'Sport'.localeCompare('Språk & Ord', 'nb')` er −1 — tredje tegn er «o» mot
// «r» — så en maskinsortering ville byttet de to. Rekkefølgen under er
// godkjent slik den står. Sorterer du lista med localeCompare et sted, får du
// altså en annen rekkefølge enn denne; kategorifilteret i
// app/admin/sporsmal/page.tsx gjør nettopp det (datadrevet, sortert på nb) og
// vil vise paret motsatt vei. Begge deler er greit — de er ulike flater — men
// ikke «rett opp» den ene mot den andre uten å spørre.
//
// TYPEN er `readonly string[]`, ikke `as const`: CSV-importen kaller
// `.includes(rawCategory)` med en vilkårlig streng fra fila, og en
// literal-union ville gjort nettopp det kallet til en typefeil.
//
// Kategoriene her har ikke nødvendigvis egne skrytetekster i
// `categoryMessages` (lib/quiz-messages.ts). En som mangler faller tilbake på
// `{category}`-settet — dokumentert og ufarlig, se kommentaren der.
export const QUIZ_CATEGORIES: readonly string[] = [
  'Film & TV',
  'Geografi',
  'Historie',
  'Kunst & Kultur',
  'Litteratur',
  'Mat & Drikke',
  'Merker & Bedrifter',
  'Musikk',
  'Politikk & Samfunn',
  'Språk & Ord',
  'Sport',
  'Teknologi',
  'Vitenskap & Natur',
  'Diverse',
]

// Restkategorien, skrevet ut så en test kan feste seg i den uten å gjenta
// strengen. Står sist i QUIZ_CATEGORIES, og skal fortsette å gjøre det.
export const QUIZ_CATEGORY_FALLBACK = 'Diverse'
