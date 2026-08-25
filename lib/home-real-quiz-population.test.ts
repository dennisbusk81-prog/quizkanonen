// Kjøres med:  npm test
//
// POPULASJONEN i app/page.tsx — forsidens tre tellende/rangerende quiz-oppslag.
//
// ── HVA SOM VAR GALT ───────────────────────────────────────────────────────
// Tre oppslag mot `quizzes` avgrenset med `.eq('is_test', false)` og INGENTING
// annet. To hull i nøyaktig den formen, begge kjent fra 30ec248:
//
//   1. `is_test` er NULLABLE med DEFAULT false, og `.eq(kolonne, false)`
//      matcher IKKE NULL-rader. Filteret var altså ikke totalt.
//   2. Ingen `quiz_type`-hviteliste. En arkivquiz (`quiz_type='archive'`, som
//      IKKE får `is_test = true`) med `closes_at` i fortiden passerte fritt.
//
// Konsekvensen er ulik per oppslag, og verst for det som PÅSTÅR et tall:
//
//   • computeFounderStoryStats → «N+ Quizer gjennomført» i grunnleggerseksjonen.
//     En arkivquiz blåser opp et tall vi viser fram som sosialt bevis.
//   • computeSharedHomeData    → «siste stengte quiz» (topp 3 + toppliste-lenke)
//   • computePageInsights      → «Ukens fakta»
//
// De to siste velges av `order('closes_at', desc)`, og det er den samme
// feilklassen som 30ec248 lukket fire andre steder: en testquiz opprettet etter
// .claude/QK_TESTQUIZ_OPPSKRIFT.md er stengt og fersk, og VINNER derfor enhver
// slik sortering. `attempts!inner` i «Ukens fakta» var ikke noe forsvar — den
// stopper kun en testquiz som ALDRI ble spilt, og oppskriften finnes nettopp
// for at testquizer SKAL spilles.
//
// ── HVORFOR EN KILDETEKST-TEST OG IKKE EN OPPFØRSELSTEST ───────────────────
// Ingen av de tre funksjonene er eksportert; alle tre lever i en
// server-komponent med JSX. Samme begrunnelse — og samme verktøykasse — som
// lib/home-error-guards.test.ts og lib/home-shared-cache.test.ts. Selve
// FILTERLOGIKKEN er oppførselstestet der den bor, i
// lib/real-quiz-population.test.ts (ekte filterevaluering, full sannhetstabell);
// det denne filen sperrer mot er WIRINGEN.
//
// ÆRLIG BEGRENSNING: en kildetekst-test kan ikke se at PostgREST faktisk leser
// filteret. Det er målt separat mot prod med positiv OG negativ kontroll — se
// motprøvene i toppen av lib/real-quiz-population.ts.
//
// ── HVORFOR KJEDER OG IKKE ET REGEX-VINDU ─────────────────────────────────
// Testene måler hver spørring som en KJEDE avgrenset på en ekte grense (der
// metodekjedingen slutter), ikke på et tegnantall. Uten det kunne et treff
// komme fra nabospørringen i samme `Promise.all` — «naboen kan oppfylle
// test-ankeret ditt». Og «dekket av helperen» avgjøres av POSISJON (ligger
// kjedens start inne i et `onlyRealQuizzes(...)`-kall), ikke av tekstlikhet:
// to kjeder kan ha identiske ledd.
//
// Kommentarer strippes først, så en utkommentert `onlyRealQuizzes(` ikke kan
// gjøre en test grønn på død kode. Strippen har egen selvtest nederst.
//
// ── MUTASJONSBEVIS (kjørt 25. august 2026, hver mutasjon gjenopprettet) ────
// Alle ni kjørt mot den ENDELIGE koden, ikke mot et mellomsteg:
//   M1 bytt `onlyRealQuizzes(quizzesBase)` mot `.eq('is_test', false)` i
//      computeFounderStoryStats → 3 røde («grunnleggertallet …» + begge
//      regnskapstestene)
//   M2 samme i computeSharedHomeData  → 3 røde («siste stengte quiz …» + begge)
//   M3 samme i computePageInsights    → 3 røde («Ukens fakta …» + begge)
//   M4 M3 PLUSS en utkommentert `// const dekning = onlyRealQuizzes(…)` som
//      falsk dekning → fortsatt 3 røde. Beviser at strippen griper: uten den
//      ville kommentaren gjort «Ukens fakta …» grønn på død kode.
//   M5 legg til et sjette `.from('quizzes')`-oppslag uten helper → 1 rød
//      («regnskapet over quiz-lesere»)
//   M6 rull cache-nøkkelen tilbake til v2 → 1 rød
//   M7 avgrens quiz-KORTET (fjern `.eq('is_test', false)` fra activeQuiz) uten
//      at purge-gaten følger med → 1 rød. Dette er den BEVISSTE grensen for
//      denne saken: kortet og cron-purgen skal endres i samme runde, og testen
//      sier fra hvis noen rører det ene alene.
//
// To mutasjoner til, i lib/home-error-guards.test.ts, fordi hoistingen flyttet
// spørringene ut av formen de to testene der matchet på (se kommentarene ved
// `erSupabaseUttrykk`):
//   N1 slutt å lese `lastClosedRes.error` → 1 rød
//   N2 slutt å destrukturere `error` på Ukens fakta → 1 rød
// N1 var GRØNN før strammingen — også på HEAD, altså en svakhet som er eldre
// enn denne saken og ikke innført av den (målt).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const RAW = readFileSync('app/page.tsx', 'utf8')

// ── Verktøy ────────────────────────────────────────────────────────────────
// Identisk med lib/home-error-guards.test.ts, av samme grunn.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const PAGE = stripComments(RAW)

/**
 * Spennet til argumentet i hvert `onlyRealQuizzes(...)`-kall, med balanserte
 * parenteser og strenge-hopping.
 *
 * Balansert uthenting og ikke et regex-vindu: uten den kunne et treff komme
 * fra kode ETTER at helper-kallet er lukket — altså en spørring som IKKE er
 * avgrenset. Strenge-hoppingen er nødvendig fordi select-listene selv
 * inneholder parenteser (`questions(count)`, `attempts!inner(...)`).
 */
function helperSpans(src: string): { start: number; slutt: number }[] {
  const ut: { start: number; slutt: number }[] = []
  const KALL = 'onlyRealQuizzes('
  let fra = 0
  for (;;) {
    const i = src.indexOf(KALL, fra)
    if (i === -1) break
    const start = i + KALL.length
    let depth = 1
    let quote: string | null = null
    let j = start
    for (; j < src.length && depth > 0; j++) {
      const c = src[j]
      if (quote) {
        if (c === '\\') { j++; continue }
        if (c === quote) quote = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue }
      if (c === '(') depth++
      else if (c === ')') depth--
    }
    assert.equal(depth, 0, 'ubalanserte parenteser i et onlyRealQuizzes-kall')
    ut.push({ start, slutt: j - 1 })
    fra = j
  }
  return ut
}

const HELPER_SPENN = helperSpans(PAGE)

/**
 * Hver spørringskjede mot `quizzes`, avgrenset der metodekjedingen slutter:
 * første tegn på dybde 0 som ikke innleder et nytt `.metode(...)`-ledd.
 */
function quizChains(src: string): { kjede: string; dekket: boolean }[] {
  const ut: { kjede: string; dekket: boolean }[] = []
  const FRA = ".from('quizzes')"
  let fra = 0
  for (;;) {
    const i = src.indexOf(FRA, fra)
    if (i === -1) break
    let depth = 0
    let quote: string | null = null
    let j = i
    for (; j < src.length; j++) {
      const c = src[j]
      if (quote) {
        if (c === '\\') { j++; continue }
        if (c === quote) quote = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue }
      if (c === '(' || c === '[' || c === '{') { depth++; continue }
      if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break
        depth--
        if (depth === 0) {
          const rest = src.slice(j + 1)
          const hopp = /^\s*/.exec(rest)![0].length
          if (rest[hopp] !== '.') { j++; break }
        }
        continue
      }
      if (depth === 0 && c === ',') break
    }
    // «Dekket» på to måter, fordi begge formene forekommer i repoet:
    //   1. kjeden ligger INNE i onlyRealQuizzes(...)-parentesene, eller
    //   2. kjeden er bundet til en variabel som sendes til onlyRealQuizzes().
    // Form 2 er husformen (ti kallsteder utenfor forsiden bruker den), og den
    // er PÅKREVD på de lengste kjedene: inlinet som argument gir TS2589 «Type
    // instantiation is excessively deep». Sjekket bare form 1, ville en
    // korrekt fikset spørring blitt meldt udekket — grønn/rød av feil grunn.
    const prefiks = src.slice(Math.max(0, i - 160), i)
    const bundet = /const\s+([A-Za-z_$][\w$]*)\s*=\s*supabaseAdmin\s*$/.exec(prefiks)
    const viaVariabel =
      bundet != null &&
      new RegExp(`onlyRealQuizzes\\(\\s*${bundet[1]}\\s*\\)`).test(src)

    ut.push({
      kjede: src.slice(i, j),
      dekket: HELPER_SPENN.some(s => i > s.start && i < s.slutt) || viaVariabel,
    })
    fra = i + FRA.length
  }
  return ut
}

const KJEDER = quizChains(PAGE)

/**
 * Diskriminatoren som peker ut hvert oppslag ENTYDIG BLANT QUIZ-KJEDENE.
 *
 * Merk at select-strengen ikke er unik i FILA for grunnleggertallet:
 * `.select('id', { count: 'exact', head: true })` står tre steder i
 * app/page.tsx, to av dem mot `attempts`. Den er derimot unik blant
 * quiz-kjedene, og det er nettopp derfor målingen skjer over dem — testen
 * under krever unikhet og ville felt en diskriminator som ikke skiller.
 */
const MÅL = [
  {
    navn: 'grunnleggertallet «N+ Quizer gjennomført» (computeFounderStoryStats)',
    anker: `.select('id', { count: 'exact', head: true })`,
  },
  {
    navn: 'siste stengte quiz — topp 3 og toppliste-lenke (computeSharedHomeData)',
    anker: `.select('id, title, season_points_awarded, questions(count)')`,
  },
  {
    navn: 'Ukens fakta (computePageInsights)',
    anker: `.select('id, attempts!inner(id, attempt_answers!inner(id))')`,
  },
] as const

for (const { navn, anker } of MÅL) {
  test(`${navn} avgrenses av onlyRealQuizzes`, () => {
    const treff = KJEDER.filter(k => k.kjede.includes(anker))
    assert.equal(
      treff.length, 1,
      `«${anker}» skal peke ut nøyaktig én kjede mot \`quizzes\` (fant ${treff.length}). ` +
      'Har spørringen flyttet på seg, skal diskriminatoren oppdateres — ikke slettes.'
    )

    assert.ok(
      treff[0].dekket,
      'spørringen må ligge INNE i et onlyRealQuizzes(...)-kall. Et eget ' +
      'inline-filter er ikke godtatt — populasjonen har ÉN definisjon, ' +
      'lib/real-quiz-population.'
    )

    assert.ok(
      !treff[0].kjede.includes(`.eq('is_test'`),
      `${navn}: \`.eq('is_test', …)\` står igjen i kjeden. Den formen matcher ` +
      'ikke `is_test IS NULL` og er nettopp det helperen erstatter.'
    )
  })
}

// ── Regnskapet over quiz-lesere på forsiden ────────────────────────────────
// Ikke bare «er de tre fikset», men «finnes det en fjerde vi ikke har sett
// på». En ny quiz-leser skal tvinge fram en beslutning her, ikke gli inn
// ufiltrert. Arbeidsregelen «en feil har som regel søsken», som en test.
const KORT_ANKER = '.select(QUIZ_CARD_COLS)'

test('regnskapet over quiz-lesere i app/page.tsx stemmer', () => {
  assert.equal(
    KJEDER.length, 5,
    `app/page.tsx har ${KJEDER.length} oppslag mot \`quizzes\`, ikke de 5 denne ` +
    'testen kjenner. Er det et NYTT oppslag: avgjør populasjonen ' +
    '(onlyRealQuizzes eller ikke) og oppdater regnskapet her med begrunnelsen.'
  )

  const dekket = KJEDER.filter(k => k.dekket).length
  assert.equal(dekket, 3, `3 av de 5 skal ligge i onlyRealQuizzes (fant ${dekket})`)

  // De 2 udekkede er quiz-KORTET (aktiv + kommende). De er BEVISST latt stå:
  // purge-gaten i app/api/cron/publish-quiz/route.ts speiler forsidens
  // activeQuiz-filter med vilje, så en endring der må tas i samme runde som
  // cronen — utenfor denne filen, og derfor utenfor denne saken.
  const udekket = KJEDER.filter(k => !k.dekket)
  assert.equal(
    udekket.filter(k => k.kjede.includes(KORT_ANKER)).length, 2,
    'de 2 udekkede oppslagene skal være quiz-kortet (aktiv + kommende), ' +
    `identifisert av \`${KORT_ANKER}\``
  )
  assert.equal(
    KJEDER.filter(k => k.dekket && k.kjede.includes(KORT_ANKER)).length, 0,
    'quiz-kortet er bevisst IKKE avgrenset her — endres det, må purge-gaten i ' +
    'app/api/cron/publish-quiz/route.ts følge med i SAMME runde (se kommentaren der)'
  )
})

test(`de eneste gjenværende .eq('is_test', false) er quiz-kortets to`, () => {
  const rester = PAGE.split(`.eq('is_test', false)`).length - 1
  assert.equal(
    rester, 2,
    `app/page.tsx har ${rester} \`.eq('is_test', false)\`, ikke de 2 som hører til ` +
    'quiz-kortet. Den formen matcher ikke `is_test IS NULL` — nye quiz-oppslag ' +
    'skal bruke onlyRealQuizzes.'
  )

  // Og begge skal stå i kort-kjedene, ikke ha vandret til en tredje spørring.
  const medFilter = KJEDER.filter(k => k.kjede.includes(`.eq('is_test', false)`))
  assert.equal(medFilter.length, 2, 'begge restene skal ligge i en quiz-kjede')
  for (const k of medFilter) {
    assert.ok(
      k.kjede.includes(KORT_ANKER),
      `en \`.eq('is_test', false)\` står på et annet quiz-oppslag enn kortet — ` +
      'bruk onlyRealQuizzes der i stedet'
    )
  }
})

// ── Cache-nøkkelen bak grunnleggertallet ───────────────────────────────────
test('grunnleggertallets cache-nøkkel er bumpet forbi den utette populasjonen', () => {
  const m = /\['home-founder-story-stats-v(\d+)'\]/.exec(PAGE)
  assert.ok(m, 'fant ikke cache-nøkkelen for grunnleggertallene')
  assert.ok(
    Number(m[1]) >= 3,
    'nøkkelen må være minst v3: en lagret v2-verdi kan være talt opp med det ' +
    'gamle, utette filteret, og med revalidate 3600 ville et oppblåst tall ' +
    'stått i en TIME etter deployen. Vercels data-cache overlever deploys.'
  )
})

// ── Selvtest på strippen ───────────────────────────────────────────────────
// Uten denne kan strippen stille slutte å virke, og alle testene over ville
// passert på utkommentert kode.
test('stripComments fjerner både linje- og blokk-kommentarer', () => {
  // Linje-regexen beholder tegnet FORAN `//` (det er del av matchen), så
  // mellomrommet i 'a ' står igjen. Det som betyr noe er at INNHOLDET er
  // borte — ellers ville en utkommentert helper gjort testene grønne.
  assert.equal(stripComments('a // onlyRealQuizzes(\nb'), 'a \nb')
  assert.equal(stripComments('a /* onlyRealQuizzes( */ b'), 'a  b')
  // `://` i en URL skal IKKE trigge linjekommentar-strippen.
  assert.ok(stripComments("const u = 'https://x.no/a'").includes('https://x.no/a'))
})
