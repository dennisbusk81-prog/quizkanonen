// Kjøres med:  npm test
//
// [A-1] — «en feilet henting skal ALDRI se ut som en tom liste».
//
// HVORFOR TO SLAGS TESTER I ÉN FIL
// Selve avgjørelsen ligger i lib/admin-load.ts og kan kjøres: hver test under
// mater inn et SIMULERT feilet svar (ingen fetch, ingen DOM, ingen nettverk) og
// krever at det kaster i stedet for å bli tomt. Det er atferdsbeviset.
//
// Wiringen — at hver side faktisk kaller helperen, og at feilkortet står FØR
// tom-tilstanden i render-treet — kan ikke kjøres uten React-testoppsett, som
// prosjektet ikke har. Den delen er strukturell, med linjestart-anker (^\s*…/m)
// slik lib/start-quiz-timeout-lærdommen krever: en substring-regex matcher også
// utkommentert kode.
//
// MUTASJONSBEVIS — hver påstand peker på en konkret feilendring den fanger, og
// alle er FAKTISK kjørt, ikke påstått:
//   • `if (!res.ok) throw` → `if (!res.ok) return []`   feller «403/500 kaster»
//   • `Array.isArray(value)` → `value ?? []`            feller «manglende nøkkel kaster»
//   • json() som kaster → returnerer {}                 feller «uleselig kropp kaster»
//   • loadError-grenen flyttet ETTER tom-grenen         feller rekkefølgetesten
//   • et `readAdminList`-kall byttet tilbake til `res.json()` feller kall-testen
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readAdminBody, pickAdminList, readAdminList } from './admin-load'

function res(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body }
}
function unreadable(status = 200) {
  return { ok: true, status, json: async () => { throw new SyntaxError('Unexpected end of JSON input') } }
}

// ── Atferd: simulerte feilede hentinger ────────────────────────────────────

test('403 kaster — den blir ikke en tom liste', async () => {
  await assert.rejects(
    () => readAdminList(res(false, 403, { rows: [] }), 'rows'),
    /403/,
    'et 403-svar ble lest som data — det er nøyaktig feilen [A-1] handler om',
  )
})

test('500 kaster — den blir ikke en tom liste', async () => {
  await assert.rejects(() => readAdminList(res(false, 500, null), 'rows'), /500/)
})

test('401 kaster også — adminFetch navigerer, men svaret er fortsatt ikke data', async () => {
  // adminFetch sender brukeren til innlogging ved 401, men returnerer responsen
  // uendret. Rakk siden å tegne før navigeringen, skal den vise feil, ikke tomt.
  await assert.rejects(() => readAdminList(res(false, 401, null), 'rows'), /401/)
})

test('200 med uleselig kropp kaster, med en melding en admin kan handle på', async () => {
  await assert.rejects(
    () => readAdminList(unreadable(), 'rows'),
    /Uleselig svar fra serveren/,
    'en avkuttet respons ga en rå SyntaxError i stedet for en forståelig feil',
  )
})

test('200 uten den forventede nøkkelen kaster — ?? [] er nettopp feilen', async () => {
  await assert.rejects(
    () => readAdminList(res(true, 200, { error: 'noe gikk galt' }), 'rows'),
    /Uventet svarformat/,
    '{ error: … } ble til en tom liste — det var slik classics/sporsmal feilet',
  )
})

test('200 der nøkkelen finnes men ikke er en liste kaster', async () => {
  await assert.rejects(() => readAdminList(res(true, 200, { rows: null }), 'rows'), /Uventet svarformat/)
  await assert.rejects(() => readAdminList(res(true, 200, { rows: 'nei' }), 'rows'), /Uventet svarformat/)
})

test('null-kropp kaster i stedet for å kaste på .rows', async () => {
  await assert.rejects(() => readAdminList(res(true, 200, null), 'rows'), /Uventet svarformat/)
})

// ── Atferd: ekte tomt skal FORTSATT være tomt ──────────────────────────────
//
// Overkorrigering er en egen feil: et vellykket 200 med tom liste ER tomt, og
// skal vises som «Ingen X ennå». Uten denne testen ville «kast alltid» bestått.

test('200 med tom liste er BEKREFTET tomt — ikke en feil', async () => {
  assert.deepEqual(await readAdminList(res(true, 200, { rows: [] }), 'rows'), [])
})

test('200 med rader gir radene', async () => {
  assert.deepEqual(await readAdminList(res(true, 200, { rows: [{ id: 'a' }] }), 'rows'), [{ id: 'a' }])
})

test('key=null betyr at kroppen SELV er lista (/api/admin/quizzes-formen)', async () => {
  assert.deepEqual(await readAdminList(res(true, 200, [{ id: 'a' }]), null), [{ id: 'a' }])
  await assert.rejects(() => readAdminList(res(true, 200, { quizzes: [] }), null), /Uventet svarformat/)
})

test('pickAdminList kan hente FLERE lister ut av én lest kropp (analytics har tre)', async () => {
  const body = await readAdminBody(res(true, 200, { questions: [1], attempts: [], answers: [2, 3] }))
  assert.deepEqual(pickAdminList(body, 'questions'), [1])
  assert.deepEqual(pickAdminList(body, 'attempts'), [])
  assert.deepEqual(pickAdminList(body, 'answers'), [2, 3])
  // Mangler ÉN av de tre, er svaret uventet — ikke «ingen svar registrert».
  assert.throws(() => pickAdminList(body, 'topPlayers'), /Uventet svarformat/)
})

// ── Wiring: hver side kaller helperen ──────────────────────────────────────

const PAGES: { file: string; label: string }[] = [
  { file: 'app/admin/retention/page.tsx',                 label: 'retention' },
  { file: 'app/admin/classics/page.tsx',                  label: 'classics' },
  { file: 'app/admin/sporsmal/page.tsx',                  label: 'sporsmal' },
  { file: 'app/admin/quizzes/[id]/analytics/page.tsx',    label: 'analytics' },
  { file: 'app/admin/quizzes/[id]/results/page.tsx',      label: 'results' },
  { file: 'app/admin/quizzes/new/page.tsx',               label: 'quizzes/new' },
]

for (const { file, label } of PAGES) {
  const src = readFileSync(file, 'utf8')

  test(`${label}: henter gjennom lib/admin-load (ikke rå res.json)`, () => {
    assert.match(src, /^import \{[^}]*read(AdminBody|AdminList)[^}]*\} from '@\/lib\/admin-load'/m,
      `${label} importerer ikke lib/admin-load — da er avgjørelsen skrevet på nytt lokalt igjen`)
    // Generisk parameter er valgfri: `readAdminList<RetentionRow>(…)` er
    // fortsatt et kall. Ankeret ^\s* holder påstanden på en AKTIV linje —
    // uten det ville en utkommentert kodelinje bestått.
    assert.match(src, /^\s*(const|return|await)[^\n]*\b(readAdminBody|readAdminList)(<[^>]*>)?\(/m,
      `${label} importerer helperen uten å kalle den på en aktiv linje`)
  })

  test(`${label}: har loadError og en «Prøv igjen»-utvei`, () => {
    assert.match(src, /^\s*const \[loadError, setLoadError\] = useState\(false\)/m,
      `${label} mangler loadError-state`)
    assert.match(src, /^\s*setLoadError\(true\)/m,
      `${label} setter aldri loadError — feilen når aldri skjermen`)
    assert.match(src, /Prøv igjen/,
      `${label} har ingen vei videre fra feiltilstanden`)
  })
}

// ── Wiring: feilkortet står FØR tom-tilstanden ─────────────────────────────
//
// Rekkefølgen ER fiksen. Står loadError-grenen etter tom-grenen i en
// if/else-kjede, vinner «Ingen X ennå» og alt over er virkningsløst.

const ORDER: { file: string; label: string; empty: string }[] = [
  { file: 'app/admin/retention/page.tsx',              label: 'retention', empty: 'Ingen fullførte attempts' },
  { file: 'app/admin/classics/page.tsx',               label: 'classics',  empty: 'Ingen klassikere ennå' },
  { file: 'app/admin/sporsmal/page.tsx',               label: 'sporsmal',  empty: 'Ingen spørsmål ennå' },
  { file: 'app/admin/quizzes/[id]/analytics/page.tsx', label: 'analytics', empty: 'Ingen data ennå' },
  { file: 'app/admin/quizzes/[id]/results/page.tsx',   label: 'results',   empty: 'Ingen resultater ennå' },
]

for (const { file, label, empty } of ORDER) {
  test(`${label}: feilkortet står FØR «${empty}» i render-treet`, () => {
    const src = readFileSync(file, 'utf8')
    // Søket starter ved komponentens `return (` — ellers ville treffet kunne
    // ligge i en kommentar lenger oppe (kommentarene siterer tom-tekstene).
    const renderAt = src.search(/^  return \(/m)
    assert.notEqual(renderAt, -1, `${label}: fant ikke komponentens return (`)
    const tree = src.slice(renderAt)

    const branch = tree.search(/^\s*\{loadError \? \(/m)
    const emptyAt = tree.indexOf(empty)
    assert.notEqual(branch, -1, `${label} har ingen {loadError ? (…) i render-treet`)
    assert.notEqual(emptyAt, -1, `${label}: fant ikke tom-teksten «${empty}» — er den omformulert?`)
    assert.ok(branch < emptyAt,
      `${label}: loadError-grenen står ETTER tom-tilstanden, så «${empty}» vinner ved lastefeil`)
  })
}

// quizzes/new har ingen tom-tilstand å stå foran — der er kravet strengere:
// feilskjermen returnerer FØR editoren tegnes i det hele tatt, så autolagringen
// aldri kan fyre på en halvlastet quiz.
test('quizzes/new: feilskjermen returnerer FØR editoren tegnes', () => {
  const src = readFileSync('app/admin/quizzes/new/page.tsx', 'utf8')
  const guard = src.search(/^\s*if \(loadError\) return \(/m)
  const editor = src.search(/^\s*const q\s+= questions\[activeIdx\]/m)
  assert.notEqual(guard, -1, 'quizzes/new mangler `if (loadError) return (` — editoren kan tegnes halvlastet')
  assert.notEqual(editor, -1, 'fant ikke editorens render-start i quizzes/new')
  assert.ok(guard < editor,
    'loadError-vakten står etter editorens render-start — en halvlastet quiz kan da tegnes')
})

test('quizzes/new: et feilet spørsmålskall blir ikke til en tom spørsmålsliste', () => {
  const src = readFileSync('app/admin/quizzes/new/page.tsx', 'utf8')
  assert.doesNotMatch(src, /^\s*const questionsBody\s*= questionsRes\.ok \?/m,
    'det gamle `questionsRes.ok ? … : { questions: [] }` er tilbake — editoren kan åpne tom på en quiz med ti spørsmål')
  assert.match(src, /^\s*const qRows = \(await readAdminList<DbQuestion>\(questionsRes, 'questions'\)\)/m,
    'spørsmålene hentes ikke lenger gjennom readAdminList')
})

test('quizzes/new: en lastefeil kaster deg ikke lenger ut av editoren uten forklaring', () => {
  const src = readFileSync('app/admin/quizzes/new/page.tsx', 'utf8')
  const load = src.slice(src.indexOf('async function loadExistingQuiz'))
  const body = load.slice(0, load.indexOf('\n  async function', 1))
  assert.doesNotMatch(body, /^\s*router\.push\('\/admin\/quizzes'\)/m,
    'loadExistingQuiz redirecter fortsatt stille ved feil i stedet for å vise feilskjermen')
})
