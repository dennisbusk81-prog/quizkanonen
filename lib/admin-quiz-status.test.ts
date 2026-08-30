// Kjøres med:  npm test  (eller smalt: --test lib/admin-quiz-status.test.ts)
//
// B-29 (30. august 2026): /admin talte og listet arkivkopier, og statusbadgen
// på /admin/quizzes kollapset fire tilstander til to.
//
// GATEN BOR TO STEDER — predikat OG kallsted. En perfekt testet funksjon som
// ingen kaller ser identisk ut med en som virker, så begge nagles her:
// utfallene behavioralt, kallstedene med strukturtester på AKTIV kode.
//
// MUTASJONSBEVIS (hver mutasjon peker på en navngitt test):
//   • NULL-sjekken fjernet fra adminQuizStatus  → «arkivkopi …» ryker
//   • 'kommende'-grenen fjernet                 → «11.09-quizen …» ryker
//   • selectRecentQuizzes filtrerer ikke        → «Siste quizer …» ryker
//   • filter/slice byttet rekkefølge            → «filtrer FØR kuttet» ryker
//   • arkiv-markøren fjernet fra badgen         → «badgen har FIRE …» ryker
//   • filteret flyttet fra teller til liste     → egne tester begge steder
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { adminQuizStatus } from './admin-quiz-status'
import { selectRecentQuizzes, RECENT_QUIZ_LIMIT } from './admin-recent-quizzes'

const NOW = new Date('2026-08-30T12:00:00Z')
// FIXTUR-REGEL: ekte, ULIKE verdier — aldri epoch, og opens/closes aldri
// samme tidspunkt, så et filter på feil felt ikke kan se riktig ut.
const OPENS_FORTID = '2026-08-28T18:00:00Z'
const CLOSES_FRAMTID = '2026-08-31T22:00:00Z'
const CLOSES_FORTID = '2026-08-23T20:30:00Z'
// Fredagsquiz 11.09.2026 — raden som sto som STENGT i prod selv om den
// åpner om to uker.
const OPENS_1109 = '2026-09-11T18:00:00Z'

// ── adminQuizStatus — fire utfall ───────────────────────────────────────────

test('arkivkopi (begge datoer NULL) er «arkiv» — ikke «åpen», ikke «stengt siden 1970»', () => {
  // Feilen denne fanger er TAUS i begge retninger: new Date(null) er EPOCH
  // 1970 (ikke Invalid Date), så en uguardet leser sier «stengt» — mens
  // spillestiens NULL-semantikk sier «åpen» og ga GRØNN badge ved siden av
  // «Slett». Ingen av de to er riktig for en arkivkopi.
  const status = adminQuizStatus(null, null, NOW)
  assert.equal(status, 'arkiv')
  assert.notEqual(status, 'åpen', 'grønn «● ÅPEN» på en arkivkopi er nettopp feilen')
  assert.notEqual(status, 'stengt', 'new Date(null) = epoch 1970 er tilbake')
})

test('11.09-quizen er «kommende», ikke «stengt» — FREMTIDIG skilles fra STENGT', () => {
  assert.equal(adminQuizStatus(OPENS_1109, null, NOW), 'kommende')
  assert.equal(adminQuizStatus(OPENS_1109, '2026-09-13T22:00:00Z', NOW), 'kommende')
})

test('åpnet og ikke stengt = åpen', () => {
  assert.equal(adminQuizStatus(OPENS_FORTID, CLOSES_FRAMTID, NOW), 'åpen')
})

test('closes_at i fortiden = stengt', () => {
  assert.equal(adminQuizStatus(OPENS_FORTID, CLOSES_FORTID, NOW), 'stengt')
})

test('ETT manglende felt er ikke arkiv — NULL-semantikken beholdes per felt', () => {
  // «arkiv» krever at BEGGE mangler. En quiz som har åpnet og ikke stenger
  // er åpen, ikke arkivert; en uten åpningstid som har stengt er stengt.
  assert.equal(adminQuizStatus(OPENS_FORTID, null, NOW), 'åpen')
  assert.equal(adminQuizStatus(null, CLOSES_FRAMTID, NOW), 'åpen')
  assert.equal(adminQuizStatus(null, CLOSES_FORTID, NOW), 'stengt')
})

test('grensesemantikken er den samme som getQuizStatus (likhet = åpen)', () => {
  const naa = NOW.toISOString()
  assert.equal(adminQuizStatus(naa, CLOSES_FRAMTID, NOW), 'åpen')
  assert.equal(adminQuizStatus(OPENS_FORTID, naa, NOW), 'åpen')
})

test('nå-tidspunktet er et ARGUMENT — samme rad gir ulikt svar på ulike tider', () => {
  // Fanger at noen flytter Date.now() inn i funksjonen: da ville begge
  // kallene under gitt samme svar, og funksjonen kunne ikke testes.
  assert.equal(adminQuizStatus(OPENS_1109, null, NOW), 'kommende')
  assert.equal(adminQuizStatus(OPENS_1109, null, new Date('2026-09-12T00:00:00Z')), 'åpen')
})

// ── selectRecentQuizzes — «Siste quizer» ────────────────────────────────────

type Rad = { id: string; title: string; updated_at: string; quiz_type: string | null; is_test: boolean | null }

const rad = (id: string, updated: string, over: Partial<Rad> = {}): Rad =>
  ({ id, title: id, updated_at: updated, quiz_type: 'weekly', is_test: false, ...over })

/**
 * Situasjonen målt i prod 30. august 2026: tre arkivkopier laget i natt er
 * de FERSKESTE radene, og fylte hele lista på tre plasser. Tallene er valgt
 * slik at et ufiltrert utvalg gir et helt annet svar enn det filtrerte.
 */
const PROD = [
  rad('fredag-2108', '2026-08-21T18:00:00Z'),
  rad('fredag-1408', '2026-08-14T18:00:00Z'),
  rad('fredag-0708', '2026-08-07T18:00:00Z'),
  rad('arkiv-a', '2026-08-30T02:10:00Z', { quiz_type: 'archive' }),
  rad('arkiv-b', '2026-08-30T02:11:00Z', { quiz_type: 'archive' }),
  rad('arkiv-c', '2026-08-30T02:12:00Z', { quiz_type: 'archive' }),
]

test('«Siste quizer» viser ikke arkivkopier i det hele tatt', () => {
  const valgt = selectRecentQuizzes(PROD).map(q => q.id)
  assert.deepEqual(valgt, ['fredag-2108', 'fredag-1408', 'fredag-0708'])
  assert.equal(valgt.filter(id => id.startsWith('arkiv')).length, 0,
    'arkivkopiene er de ferskeste radene og la seg øverst i lista')
})

test('filtrer FØR kuttet — ellers gir tre arkivkopier tre tomme plasser', () => {
  // Mutasjonen som ser identisk ut i en diff: .slice(0, 3) før .filter().
  // Da hadde utvalget her blitt tomt, ikke tre fredagsquizer.
  assert.equal(selectRecentQuizzes(PROD).length, RECENT_QUIZ_LIMIT)
})

test('BEGGE testformene faller ut — ikke bare quiz_type === «archive»', () => {
  // En håndskrevet `quiz_type !== 'archive'` ville sluppet begge disse
  // gjennom. Derfor `erEkteQuiz`, som speiler onlyRealQuizzes på radnivå.
  const rader = [
    rad('ekte', '2026-08-21T18:00:00Z'),
    rad('testtype', '2026-08-29T10:00:00Z', { quiz_type: 'test', is_test: true }),
    rad('testbryter', '2026-08-29T11:00:00Z', { quiz_type: 'weekly', is_test: true }),
  ]
  assert.deepEqual(selectRecentQuizzes(rader).map(q => q.id), ['ekte'])
})

test('sorterer nyest først, og muterer ikke inndata', () => {
  const inn = [...PROD]
  const rekkefolge = inn.map(q => q.id)
  const ut = selectRecentQuizzes(inn)
  assert.equal(ut[0].id, 'fredag-2108', 'nyest oppdaterte ekte quiz først')
  assert.deepEqual(inn.map(q => q.id), rekkefolge,
    'inndata ble sortert på stedet — kalleren holder samme array i React-state')
})

// ── KALLSTEDENE ─────────────────────────────────────────────────────────────
// Strukturelle, men på AKTIV kode: kommentarer strippes først, ellers ville
// en utkommentert linje oppfylt ankeret.

const rot = join(import.meta.dirname, '..')

function aktivKode(sti: string): string {
  return readFileSync(join(rot, sti), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\n \t])\/\/[^\n]*/g, '$1')
}

const ADMIN_FORSIDE = 'app/admin/page.tsx'
const ADMIN_LISTE = 'app/admin/quizzes/page.tsx'

test('kallsted: «Siste quizer» går gjennom selectRecentQuizzes', () => {
  const kode = aktivKode(ADMIN_FORSIDE)
  assert.match(kode, /import \{ selectRecentQuizzes \} from '@\/lib\/admin-recent-quizzes'/)
  assert.match(
    kode,
    /setRecentQuizzes\(selectRecentQuizzes\(all\)\)/,
    'utvalget er skrevet på nytt på kallstedet — arkivkopiene er tilbake øverst'
  )
  assert.doesNotMatch(
    kode,
    /setRecentQuizzes\(\s*sorted\.slice/,
    'den gamle, ufiltrerte sorteringen er gjeninnført'
  )
})

test('kallsted: forsidens statuslinje leser den delte adminQuizStatus', () => {
  const kode = aktivKode(ADMIN_FORSIDE)
  assert.match(kode, /const status = adminQuizStatus\(quiz\.opens_at, quiz\.closes_at, now\)/)
  assert.doesNotMatch(
    kode,
    /const isOpen = opensAt && opensAt <= now/,
    'den tredje inline-kopien av statuslogikken er tilbake'
  )
})

test('kallsted: badgen på /admin/quizzes har FIRE grener, arkiv merket og ikke grønn', () => {
  const kode = aktivKode(ADMIN_LISTE)
  assert.match(kode, /import \{ adminQuizStatus \} from '@\/lib\/admin-quiz-status'/)
  assert.match(kode, /const status = adminQuizStatus\(quiz\.opens_at, quiz\.closes_at, new Date\(\)\)/)
  assert.match(
    kode,
    /status === 'arkiv'\) return <span className="aqz-badge arkiv">Arkiv<\/span>/,
    'arkiv-markøren er borte — en arkivkopi står igjen som «● Åpen» ved siden av «Slett»'
  )
  assert.match(
    kode,
    /status === 'kommende'\) return <span className="aqz-badge kommende">Planlagt<\/span>/,
    'FREMTIDIG er kollapset ned i «Stengt» igjen'
  )
  // Fargen: arkiv-klassen må finnes i stilarket og skal ikke arve den grønne.
  // Leses fra RÅ kilde — regelen står i en /* */-kommentert CSS-blokk som
  // aktivKode() ellers ville strippet.
  const raa = readFileSync(join(rot, ADMIN_LISTE), 'utf8')
  const arkivRegel = raa.match(/\.aqz-badge\.arkiv\s*\{([^}]*)\}/)
  assert.ok(arkivRegel, 'stilregelen .aqz-badge.arkiv finnes ikke — badgen er uten farge')
  assert.doesNotMatch(arkivRegel[1], /var\(--green\)|74,\s*222,\s*128/, 'arkiv skal ikke være grønn')
  assert.doesNotMatch(arkivRegel[1], /var\(--gold\)|#c9a84c/i, 'gullet eies av primærknappen på denne skjermen')
})

test('kallsted: /admin/quizzes filtrerer ALDRI bort arkivkopiene', () => {
  // Peker MOTSATT vei av testene over, med vilje. Den billigste
  // «konsistens»-endringen noen kan gjøre er å legge samme filter her som på
  // forsiden — og da mister admin veien til å finne og slette arkivkopiene.
  //
  // Ankeret ble byttet 30. august 2026 (B-29b). Fram til da sto det som
  // «fila nevner ikke onlyRealQuizzes/erEkteQuiz» — et navne-anker, som
  // slutter å svare på spørsmålet i det øyeblikket arkivkopiene deles ut i
  // en egen SEKSJON i stedet for å filtreres bort. Invarianten er ikke
  // «ingen filternavn i fila», den er «ingen rad forsvinner»:
  // splitAdminQuizList er uttømmende (testdekket i
  // lib/admin-quiz-groups.test.ts), og siden rendrer BEGGE gruppene.
  const kode = aktivKode(ADMIN_LISTE)
  assert.match(kode, /\{ekte\.map\(quizKort\)\}/)
  assert.match(kode, /\{arkiv\.map\(quizKort\)\}/,
    'arkivgruppen rendres ikke lenger — kopiene er borte fra flaten, og med dem eneste vei til å slette dem')
  assert.doesNotMatch(kode, /quizzes\.filter\(|\.filter\(erEkteQuiz\)/,
    'lista er filtrert i stedet for delt')
})
