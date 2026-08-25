// Kjøres med:  npm test
//
// POPULASJONEN i app/page.tsx — forsidens fem oppslag mot `quizzes` — OG
// speilingen mellom quiz-KORTET og cache-purge-gaten i
// app/api/cron/publish-quiz/route.ts.
//
// ── HVA SOM VAR GALT ───────────────────────────────────────────────────────
// Oppslagene avgrenset med `.eq('is_test', false)` og INGENTING annet. To hull
// i nøyaktig den formen, begge kjent fra 30ec248:
//
//   1. `is_test` er NULLABLE med DEFAULT false, og `.eq(kolonne, false)`
//      matcher IKKE NULL-rader. Filteret var altså ikke totalt.
//   2. Ingen `quiz_type`-hviteliste. En arkivquiz (`quiz_type='archive'`, som
//      IKKE får `is_test = true`) passerte fritt.
//
// Konsekvensen er ulik per oppslag, og verst for det som PÅSTÅR noe:
//
//   • computeFounderStoryStats → «N+ Quizer gjennomført» i grunnleggerseksjonen.
//     En arkivquiz blåser opp et tall vi viser fram som sosialt bevis.
//   • computeSharedHomeData    → «siste stengte quiz» (topp 3 + toppliste-lenke)
//   • computePageInsights      → «Ukens fakta»
//   • quiz-KORTET              → activeQuiz + upcomingQuiz, altså selve
//     påstanden om at det finnes en quiz å spille nå eller snart.
//
// De tre første velges av `order('closes_at', desc)`, og det er den samme
// feilklassen som 30ec248 lukket fire andre steder: en testquiz opprettet etter
// .claude/QK_TESTQUIZ_OPPSKRIFT.md er stengt og fersk, og VINNER derfor enhver
// slik sortering. `attempts!inner` i «Ukens fakta» var ikke noe forsvar — den
// stopper kun en testquiz som ALDRI ble spilt, og oppskriften finnes nettopp
// for at testquizer SKAL spilles.
//
// ── HVORFOR KORTET OG CRONEN ER ÉN SAK ────────────────────────────────────
// Purge-gaten i app/api/cron/publish-quiz/route.ts speiler activeQuiz-filteret
// med vilje: den purger forsidens to cacher KUN når det finnes en quiz forsiden
// faktisk kan vise. De to må derfor svare på nøyaktig samme spørsmål, og det
// gamle filteret svarte feil i BEGGE retninger samtidig:
//
//   • `is_test IS NULL` — kortet viste quizen, gaten så den ikke. Quizen sto
//     på forsiden med et deltakertall som ikke tikket.
//   • `quiz_type='archive'` — gaten så den, kortet burde ikke vist den.
//     Forsidens tyngste spørringer ble rekomputert hvert minutt uten grunn.
//
// Retter man ÉN av dem, forsvinner ikke uenigheten — den bytter bare fortegn.
// Testen «paret kan ikke brytes opp» nederst måler nettopp likheten, ikke bare
// at hver side er korrekt hver for seg.
//
// ── HVORFOR EN KILDETEKST-TEST OG IKKE EN OPPFØRSELSTEST ───────────────────
// Ingen av forsidens funksjoner er eksportert; alle lever i en server-komponent
// med JSX. Samme begrunnelse — og samme verktøykasse — som
// lib/home-error-guards.test.ts og lib/home-shared-cache.test.ts. Selve
// FILTERLOGIKKEN er oppførselstestet der den bor, i
// lib/real-quiz-population.test.ts (ekte filterevaluering, full sannhetstabell);
// det denne filen sperrer mot er WIRINGEN. Cron-rutens oppførsel er dessuten
// dekket av lib/publish-quiz-resettle-route.test.ts.
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
// Alle kjørt mot den ENDELIGE koden, ikke mot et mellomsteg:
//   M1 bytt `onlyRealQuizzes(quizzesBase)` mot `.eq('is_test', false)` i
//      computeFounderStoryStats → 3 røde
//   M2 samme i computeSharedHomeData («siste stengte quiz») → 3 røde
//   M3 samme i computePageInsights → 3 røde
//   M4 M3 PLUSS en utkommentert `// const dekning = onlyRealQuizzes(…)` som
//      falsk dekning → fortsatt 3 røde. Beviser at strippen griper: uten den
//      ville kommentaren gjort «Ukens fakta …» grønn på død kode.
//   M5 legg til et sjette `.from('quizzes')`-oppslag på forsiden uten helper
//      → 1 rød («regnskapet over quiz-lesere»)
//   M6 rull cache-nøkkelen for grunnleggertallet tilbake til v2 → 1 rød
//
// De fem siste er PARET, og de er grunnen til at denne filen leser to filer:
//   M7 avgrens KORTET tilbake til `.eq('is_test', false)` (begge oppslag), la
//      purge-gaten stå → 5 røde, inkludert «paret kan ikke brytes opp»
//   M8 MOTSATT VEI: rull purge-gaten tilbake, la kortet stå → 2 røde,
//      inkludert «paret kan ikke brytes opp»
//   M9 rull BEGGE tilbake — paret er da «enig» igjen, men enig om feil
//      populasjon → 6 røde. Profilen måles også mot FASIT, ikke bare mot den
//      andre siden; uten det ville denne mutasjonen vært grønn på nøyaktig
//      tilstanden saken lukket.
//   M10 legg til et femte `.from('quizzes')`-oppslag i cron-ruten → 1 rød
//      («regnskapet over quiz-oppslag i cron/publish-quiz»)
//   M11 fjern `.lte('opens_at', …)` KUN på purge-siden → 1 rød, og den ene er
//      «paret kan ikke brytes opp». Den mutasjonen rører hverken dekning eller
//      `is_test`, så ingen av de andre testene ser den — beviset på at
//      speilings-testen bærer noe de øvrige ikke gjør.
//
// To mutasjoner til, i lib/home-error-guards.test.ts, fordi hoistingen flyttet
// spørringene ut av formen de to testene der matchet på (se kommentarene ved
// `erSupabaseUttrykk`):
//   N1 slutt å lese `lastClosedRes.error` → rød
//   N2 slutt å destrukturere `error` på Ukens fakta → rød
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PAGE_FIL = 'app/page.tsx'
const CRON_FIL = 'app/api/cron/publish-quiz/route.ts'

// ── Verktøy ────────────────────────────────────────────────────────────────
// Identisk med lib/home-error-guards.test.ts, av samme grunn.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const PAGE = stripComments(readFileSync(PAGE_FIL, 'utf8'))
const CRON = stripComments(readFileSync(CRON_FIL, 'utf8'))

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

type Kjede = { kjede: string; dekket: boolean }

/**
 * Hver spørringskjede mot `quizzes` i en kildefil, avgrenset der
 * metodekjedingen slutter: første tegn på dybde 0 som ikke innleder et nytt
 * `.metode(...)`-ledd.
 *
 * Tar kilden som ARGUMENT (25. august 2026) i stedet for å lese en modulglobal:
 * paret kortet↔purge-gaten bor i to filer, og en test som bare kunne se den ene
 * kunne per definisjon ikke måle speilingen mellom dem.
 */
function quizChains(src: string): Kjede[] {
  const spenn = helperSpans(src)
  const ut: Kjede[] = []
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
      dekket: spenn.some(s => i > s.start && i < s.slutt) || viaVariabel,
    })
    fra = i + FRA.length
  }
  return ut
}

const KJEDER = quizChains(PAGE)
const CRON_KJEDER = quizChains(CRON)

/** Nøyaktig én kjede skal matche ankeret — ellers er ankeret ubrukelig. */
function énKjede(kjeder: Kjede[], anker: string, hvor: string): Kjede {
  const treff = kjeder.filter(k => k.kjede.includes(anker))
  assert.equal(
    treff.length, 1,
    `«${anker}» skal peke ut nøyaktig én kjede mot \`quizzes\` i ${hvor} ` +
    `(fant ${treff.length}). Har spørringen flyttet på seg, skal ` +
    'diskriminatoren oppdateres — ikke slettes.'
  )
  return treff[0]
}

/**
 * Diskriminatoren som peker ut hvert oppslag ENTYDIG BLANT QUIZ-KJEDENE.
 *
 * Merk at select-strengen ikke er unik i FILA for grunnleggertallet:
 * `.select('id', { count: 'exact', head: true })` står tre steder i
 * app/page.tsx, to av dem mot `attempts`. Den er derimot unik blant
 * quiz-kjedene, og det er nettopp derfor målingen skjer over dem — `énKjede`
 * krever unikhet og ville felt en diskriminator som ikke skiller.
 *
 * Kortets to oppslag deler select-liste (`QUIZ_CARD_COLS`) og skilles derfor på
 * tidsleddet: `lte` for den som er åpen NÅ, `gt` for den som åpner senere.
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
  {
    navn: 'quiz-kortet — aktiv quiz (activeQuiz)',
    anker: `.lte('opens_at', nowIso)`,
  },
  {
    navn: 'quiz-kortet — kommende quiz (upcomingQuiz)',
    anker: `.gt('opens_at', nowIso)`,
  },
] as const

for (const { navn, anker } of MÅL) {
  test(`${navn} avgrenses av onlyRealQuizzes`, () => {
    const k = énKjede(KJEDER, anker, PAGE_FIL)

    assert.ok(
      k.dekket,
      'spørringen må ligge INNE i et onlyRealQuizzes(...)-kall. Et eget ' +
      'inline-filter er ikke godtatt — populasjonen har ÉN definisjon, ' +
      'lib/real-quiz-population.'
    )

    assert.ok(
      !k.kjede.includes(`.eq('is_test'`),
      `${navn}: \`.eq('is_test', …)\` står igjen i kjeden. Den formen matcher ` +
      'ikke `is_test IS NULL` og er nettopp det helperen erstatter.'
    )
  })
}

// ── Regnskapet over quiz-lesere på forsiden ────────────────────────────────
// Ikke bare «er de fikset», men «finnes det en sjette vi ikke har sett på». En
// ny quiz-leser skal tvinge fram en beslutning her, ikke gli inn ufiltrert.
// Arbeidsregelen «en feil har som regel søsken», som en test.
test('regnskapet over quiz-lesere i app/page.tsx stemmer', () => {
  assert.equal(
    KJEDER.length, 5,
    `${PAGE_FIL} har ${KJEDER.length} oppslag mot \`quizzes\`, ikke de 5 denne ` +
    'testen kjenner. Er det et NYTT oppslag: avgjør populasjonen ' +
    '(onlyRealQuizzes eller ikke) og oppdater regnskapet her med begrunnelsen.'
  )

  const dekket = KJEDER.filter(k => k.dekket).length
  assert.equal(
    dekket, 5,
    `alle 5 skal ligge i onlyRealQuizzes (fant ${dekket}). Fra 25. august 2026 ` +
    'er det ingen unntak igjen på forsiden — quiz-kortet var det siste, og det ' +
    `ble lukket sammen med purge-gaten i ${CRON_FIL}.`
  )
})

test(`ingen .eq('is_test', false) står igjen i app/page.tsx`, () => {
  const rester = PAGE.split(`.eq('is_test', false)`).length - 1
  assert.equal(
    rester, 0,
    `${PAGE_FIL} har ${rester} \`.eq('is_test', false)\`. Den formen matcher ` +
    'ikke `is_test IS NULL` — quiz-oppslag skal bruke onlyRealQuizzes.'
  )
})

// ── Regnskapet over quiz-oppslag i cron-ruten ──────────────────────────────
test('regnskapet over quiz-oppslag i cron/publish-quiz stemmer', () => {
  assert.equal(
    CRON_KJEDER.length, 4,
    `${CRON_FIL} har ${CRON_KJEDER.length} oppslag mot \`quizzes\`, ikke de 4 ` +
    'denne testen kjenner (publiserings-UPDATE, purge-gaten, oppgjørs-utvalget ' +
    'og rekjørings-utvalget i RESETTLE_SCAN_MS-vinduet).'
  )

  const dekket = CRON_KJEDER.filter(k => k.dekket).length
  assert.equal(dekket, 3, `3 av de 4 skal ligge i onlyRealQuizzes (fant ${dekket})`)

  // Den ene udekkede er publiserings-UPDATE-en, og den er BEVISST udekket: den
  // er ingen leser og rangerer ingen. Den setter is_active=true på det admin
  // selv har planlagt via scheduled_at — også for en testquiz, som
  // .claude/QK_TESTQUIZ_OPPSKRIFT.md er avhengig av (is_active=true er PÅKREVD
  // for at anon-lesingen i spillsiden skal se quizen i det hele tatt).
  const udekket = CRON_KJEDER.filter(k => !k.dekket)
  assert.equal(udekket.length, 1)
  assert.ok(
    udekket[0].kjede.includes('.update({ is_active: true })'),
    'det udekkede oppslaget skal være publiserings-UPDATE-en. Er det noe ' +
    'annet, er en leser sluppet ut av populasjonen — avgjør den her.'
  )
})

// ── PARET: quiz-kortet ↔ purge-gaten ───────────────────────────────────────
// Denne testen er grunnen til at de to filene endres i samme commit.
//
// Testene over sier «hver side er korrekt». Denne sier «sidene er ENIGE» — og
// det er en strengere påstand. Ruller man én av dem tilbake, forsvinner ikke
// uenigheten mellom forsiden og cronen; den bytter bare fortegn, og det nye
// symptomet er stillere enn det gamle.
//
// Profilen sammenlignes DESSUTEN mot fasit, ikke bare mot den andre siden.
// Uten det ville en tilbakerulling av BEGGE gitt to enige, men like gale sider
// — en grønn test på nøyaktig den tilstanden denne saken lukket.
const PURGE_ANKER = 'closes_at.gte.${purgeWindowStart}'

type Profil = {
  dekketAvHelperen: boolean
  harGammeltIsTestFilter: boolean
  harÅpnetVindu: boolean
  harStengeVindu: boolean
}

function profil(k: Kjede): Profil {
  return {
    dekketAvHelperen: k.dekket,
    harGammeltIsTestFilter: k.kjede.includes(`.eq('is_test'`),
    // Begge sider spør «har denne quizen åpnet?» og «er den ikke stengt
    // (ennå)?». Ledd-formen er identisk; kun tidsgrensen skiller (cronen skyver
    // stengegrensen 10 minutter bakover, og det er med vilje).
    harÅpnetVindu: /\.lte\('opens_at',/.test(k.kjede),
    harStengeVindu: k.kjede.includes('closes_at.is.null,closes_at.gte.'),
  }
}

test('paret kan ikke brytes opp: quiz-kortet og purge-gaten speiler hverandre', () => {
  const kort  = énKjede(KJEDER, `.lte('opens_at', nowIso)`, PAGE_FIL)
  const purge = énKjede(CRON_KJEDER, PURGE_ANKER, CRON_FIL)

  const FASIT: Profil = {
    dekketAvHelperen: true,
    harGammeltIsTestFilter: false,
    harÅpnetVindu: true,
    harStengeVindu: true,
  }

  assert.deepEqual(
    profil(kort), profil(purge),
    `quiz-kortets activeQuiz (${PAGE_FIL}) og purge-gaten (${CRON_FIL}) har ` +
    'ULIK populasjonsprofil. De to speiler hverandre med vilje: gaten purger ' +
    'forsidens cacher KUN når det finnes en quiz forsiden faktisk kan vise. ' +
    'Endrer du den ene, må den andre følge med i SAMME commit — ellers står ' +
    'enten en quiz på forsiden med et deltakertall som ikke tikker, eller ' +
    'forsidens tyngste spørringer rekomputeres hvert minutt for en quiz ingen ser.'
  )

  assert.deepEqual(
    profil(kort), FASIT,
    'begge sider er enige, men enige om FEIL populasjon. Kortet og gaten skal ' +
    "begge gå via onlyRealQuizzes — `.eq('is_test', false)` matcher ikke " +
    '`is_test IS NULL` og sier ingenting om quiz_type.'
  )
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
