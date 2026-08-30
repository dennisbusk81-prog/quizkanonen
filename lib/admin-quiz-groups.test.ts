// Kjøres med:  npm test  (eller smalt: --test lib/admin-quiz-groups.test.ts)
//
// B-29b (30. august 2026): arkivkopiene lå ØVERST i «Alle quizer» fordi de er
// nyest opprettet, og skjøv Dennis' tre ekte quizer under skjermkanten. Hver
// arkivrunde han spiller legger til én ny på toppen, for alltid.
//
// Delingen er IKKE et filter: arkivkopiene skal bli værende på flaten — den
// er eneste vei til å slette dem. Testene her peker derfor BEGGE veier:
// arkivet ut av hovedlista, OG ingen rad tapt på veien.
//
// MUTASJONSBEVIS (hver mutasjon peker på en navngitt test):
//   • delingen fjernet fra siden          → «kallsted: … to grupper» ryker
//   • predikatet snudd                    → «ekte quiz havner ALDRI …» ryker
//   • seksjonen åpen som standard (`open`) → «lukket som standard» ryker
//   • seksjonen rendret ved null arkiv     → «null arkivkopier …» ryker
//   • Slett-knappen borte fra arkivradene  → «samme kortrenderer …» ryker
//   • ARKIV-merket borte fra radene        → dekkes av admin-quiz-status.test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { splitAdminQuizList, arkivGruppeTittel } from './admin-quiz-groups'

type Rad = { id: string; created_at: string; quiz_type: string | null; is_test: boolean | null }

const rad = (id: string, created: string, over: Partial<Rad> = {}): Rad =>
  ({ id, created_at: created, quiz_type: 'weekly', is_test: false, ...over })

/**
 * Situasjonen Dennis så i prod etter c32c62d: tre arkivkopier laget i natt
 * ligger foran de tre ekte quizene i rutens `created_at` DESC-rekkefølge.
 * Datoene er ekte og ULIKE, så en test ikke kan passere på tilfeldig
 * rekkefølge.
 */
const PROD = [
  rad('arkiv-c', '2026-08-30T02:12:00Z', { quiz_type: 'archive' }),
  rad('arkiv-b', '2026-08-30T02:11:00Z', { quiz_type: 'archive' }),
  rad('arkiv-a', '2026-08-30T02:10:00Z', { quiz_type: 'archive' }),
  rad('fredag-1109', '2026-08-29T09:00:00Z'),
  rad('fredag-0409', '2026-08-22T09:00:00Z'),
  rad('fredag-2808', '2026-08-15T09:00:00Z'),
]

// ── splitAdminQuizList ──────────────────────────────────────────────────────

test('arkivkopiene ut av hovedlista — fredagsquizene står øverst alene', () => {
  const { ekte, arkiv } = splitAdminQuizList(PROD)
  assert.deepEqual(ekte.map(q => q.id), ['fredag-1109', 'fredag-0409', 'fredag-2808'])
  assert.deepEqual(arkiv.map(q => q.id), ['arkiv-c', 'arkiv-b', 'arkiv-a'])
})

test('en ekte quiz havner ALDRI i arkivgruppen, og motsatt', () => {
  // Fanger et snudd predikat. Uten denne ville en inversjon sett helt normal
  // ut i en diff — begge gruppene er fortsatt ikke-tomme.
  const { ekte, arkiv } = splitAdminQuizList(PROD)
  assert.ok(ekte.every(q => q.id.startsWith('fredag')), 'en arkivkopi lekket inn i hovedlista')
  assert.ok(arkiv.every(q => q.id.startsWith('arkiv')), 'en fredagsquiz havnet i arkivgruppen')
})

test('delingen er UTTØMMENDE — ingen rad forsvinner', () => {
  // Peker motsatt vei av testene over, med vilje: arkivkopiene skal BLI
  // VÆRENDE på flaten. Et filter der det skulle stått en deling ville
  // fjernet Dennis' eneste vei til å slette dem.
  const { ekte, arkiv } = splitAdminQuizList(PROD)
  assert.equal(ekte.length + arkiv.length, PROD.length)
  assert.deepEqual(
    [...ekte, ...arkiv].map(q => q.id).sort(),
    PROD.map(q => q.id).sort(),
  )
})

test('BEGGE testformene havner i arkivgruppen — ikke bare quiz_type «archive»', () => {
  // Admin-editorens testbryter setter `is_test = true` mens `quiz_type`
  // fortsatt står på 'weekly'. En håndskrevet `quiz_type === 'archive'`
  // ville sluppet den opp i hovedlista, og den er like mye forurensning.
  const rader = [
    rad('ekte', '2026-08-29T09:00:00Z'),
    rad('testtype', '2026-08-29T10:00:00Z', { quiz_type: 'test', is_test: true }),
    rad('testbryter', '2026-08-29T11:00:00Z', { quiz_type: 'weekly', is_test: true }),
    rad('arkiv', '2026-08-30T02:10:00Z', { quiz_type: 'archive' }),
  ]
  const { ekte, arkiv } = splitAdminQuizList(rader)
  assert.deepEqual(ekte.map(q => q.id), ['ekte'])
  assert.deepEqual(arkiv.map(q => q.id).sort(), ['arkiv', 'testbryter', 'testtype'])
})

test('rekkefølgen fra ruten er urørt i begge gruppene', () => {
  // Delingen skal ikke sortere om. Hovedlista beholder created_at DESC.
  const { ekte } = splitAdminQuizList(PROD)
  assert.deepEqual(ekte.map(q => q.created_at), [
    '2026-08-29T09:00:00Z', '2026-08-22T09:00:00Z', '2026-08-15T09:00:00Z',
  ])
})

test('tom liste gir to tomme grupper, ikke en feil', () => {
  const { ekte, arkiv } = splitAdminQuizList([])
  assert.deepEqual(ekte, [])
  assert.deepEqual(arkiv, [])
})

// ── arkivGruppeTittel ───────────────────────────────────────────────────────

test('overskriften bærer antallet — «Arkivkopier (3)»', () => {
  const { arkiv } = splitAdminQuizList(PROD)
  assert.equal(arkivGruppeTittel(arkiv), 'Arkivkopier (3)')
})

test('overskriften lyver ikke når gruppen også rommer en testquiz', () => {
  // Gruppen er definert som «ikke ekte quiz», så en testquiz havner her.
  // Etiketten utledes av innholdet i stedet for å være en konstant.
  const blandet = [
    rad('arkiv', '2026-08-30T02:10:00Z', { quiz_type: 'archive' }),
    rad('testbryter', '2026-08-29T11:00:00Z', { quiz_type: 'weekly', is_test: true }),
  ]
  assert.equal(arkivGruppeTittel(blandet), 'Arkivkopier og testquizer (2)')
})

// ── KALLSTEDET ──────────────────────────────────────────────────────────────
// Strukturelt, men på AKTIV kode: kommentarer strippes først, ellers ville en
// utkommentert linje oppfylt ankeret.

const rot = join(import.meta.dirname, '..')
const ADMIN_LISTE = 'app/admin/quizzes/page.tsx'

function aktivKode(sti: string): string {
  return readFileSync(join(rot, sti), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\n \t])\/\/[^\n]*/g, '$1')
}

test('kallsted: lista rendres som to grupper, ikke én', () => {
  const kode = aktivKode(ADMIN_LISTE)
  assert.match(kode, /import \{ splitAdminQuizList, arkivGruppeTittel \} from '@\/lib\/admin-quiz-groups'/)
  assert.match(kode, /const \{ ekte, arkiv \} = splitAdminQuizList\(quizzes\)/)
  assert.match(kode, /\{ekte\.map\(quizKort\)\}/, 'hovedlista rendrer ikke den ekte gruppen')
  assert.match(kode, /\{arkiv\.map\(quizKort\)\}/, 'arkivgruppen rendres ikke — kopiene er borte fra flaten')
  assert.doesNotMatch(
    kode,
    /\{quizzes\.map\(quiz => \(/,
    'den udelte lista er tilbake — arkivkopiene ligger øverst igjen'
  )
})

test('kallsted: arkivseksjonen er LUKKET som standard og holder ingen tilstand', () => {
  const kode = aktivKode(ADMIN_LISTE)
  assert.match(kode, /<details className="aqz-arkiv">/)
  // `open` på elementet, eller en useState som styrer det, er begge samme
  // feil: seksjonen skal være lukket hver gang siden lastes.
  assert.doesNotMatch(kode, /<details className="aqz-arkiv"[^>]*\sopen/,
    'seksjonen står åpen som standard')
  assert.doesNotMatch(kode, /useState[^\n]*[Aa]rkiv/,
    'åpen/lukket-tilstanden er flyttet inn i React-state — den skal ikke lagres')
})

test('kallsted: null arkivkopier gir ingen seksjon i det hele tatt', () => {
  const kode = aktivKode(ADMIN_LISTE)
  assert.match(
    kode,
    /\{arkiv\.length > 0 && \(\s*<details className="aqz-arkiv">/,
    'seksjonen rendres uten vakt — en tom overskrift er støy'
  )
})

test('kallsted: arkivradene bruker SAMME kortrenderer — Slett virker fortsatt', () => {
  const kode = aktivKode(ADMIN_LISTE)
  // Én renderer, kalt av begge gruppene: da kan ikke arkivraden miste en
  // handling uten at hovedlista mister den samtidig.
  assert.match(kode, /const quizKort = \(quiz: Quiz\) => \(/)
  const kall = kode.match(/quizKort\)/g) ?? []
  assert.equal(kall.length, 2, 'begge gruppene skal kalle den samme renderen')
  // «Slett» er Dennis' eneste vei til å rydde arkivkopiene, og «Reset» /
  // statusBadge står i samme kort.
  const renderer = kode.slice(kode.indexOf('const quizKort = (quiz: Quiz) => ('))
  for (const handling of ['deleteQuiz(quiz.id, quiz.title)', 'resetQuiz(quiz.id, quiz.title)', 'statusBadge(quiz)']) {
    assert.ok(renderer.includes(handling), `${handling} mangler i kortrendereren`)
  }
})

test('kallsted: seksjonsoverskriften er dempet, ikke en ny gullflate', () => {
  // Skjermen har allerede «+ Ny quiz» i gull — to gule elementer på samme
  // skjerm er forbudt i designsystemet.
  const raa = readFileSync(join(rot, ADMIN_LISTE), 'utf8')
  const regel = raa.match(/\.aqz-arkiv-tittel\s*\{([^}]*)\}/)
  assert.ok(regel, 'stilregelen .aqz-arkiv-tittel finnes ikke')
  assert.match(regel[1], /color:\s*var\(--muted\)/, 'overskriften skal være dempet')
  assert.doesNotMatch(regel[1], /var\(--gold\)|#c9a84c/i, 'gullet eies av «+ Ny quiz» på denne skjermen')
})
