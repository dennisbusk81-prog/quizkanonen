// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: /premium/success skal ALDRI sende en betalende kunde til
// salgssiden fordi VI ikke fikk verifisert betalingen. «Vet ikke» er ikke
// «nei» — samme regel som app/quiz/[id]/page.tsx formulerer for
// rangeringsfeil.
//
// ── HVILKEN FEIL DENNE FILEN FINNES FOR ─────────────────────────────────────
// Fram til 29. august 2026 hadde siden to tilstander ('verifying' | 'paid')
// og INGEN feiltilstand. Hver feilvei endte i en redirect bort fra
// kvitteringen: !res.ok og paid=false ga router.replace('/premium'), et
// kastende fetch det samme, og manglende sesjon ga router.replace('/login')
// uten ?next=. Kortet var belastet; kunden landet på en side med «kr 49/mnd»
// og null forklaring. getSession() lå dessuten UTENFOR try — kastet den, hang
// «Aktiverer Premium…» for alltid, uten nav, uten timeout.
//
// Søsknene var allerede herdet: app/founders/success (withTimeout +
// UkjentView i alle feilgrener) og app/bedrift/success (hard timeout 5 s).
// Den ene kvitteringen som tar EKTE PENGER var ikke.
//
// Hvorfor kildetekst-test og ikke oppførselstest: samme grunn som
// lib/sitenav-error-states.test.ts — npm test kjører kun lib/**/*.test.ts
// under Node sin egen runner, uten jsdom, og flaten er en klientkomponent.
// Nav-dekningen på de fire grenene felles av lib/sitenav-error-states.test.ts;
// denne fila feller redirectene og hengemulighetene.
//
// MUTASJONSBEVIS — hver test peker på en konkret feilendring den fanger:
//   • En redirect legges tilbake i EN feilgren → «nøyaktig én router.replace»
//     ryker (telleren blir 2), uansett hvilken gren.
//   • /login-redirecten gjeninnføres → samme test + «ingen /login-redirect».
//   • getSession() flyttes ut av try → «getSession ligger inne i try» ryker.
//   • 500 ms-omforsøket fjernes → «omforsøk på sesjonshydrering» ryker.
//   • Hard-timeren fjernes eller mister verifying-vakten → timeout-testene.
//   • ?next= mister encoding → «login-lenken bærer encodet next» ryker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FIL = 'app/premium/success/page.tsx'

// Samme kommentar-stripping som lib/sitenav-error-states.test.ts: prosaen i
// kildekommentarene (og i denne fila) nevner både router.replace og /premium.
// CRLF normaliseres først: med core.autocrlf=true kan arbeidskopien ha \r\n
// (f.eks. rett etter en `git checkout --`), og ankrene under spenner over
// linjeskift.
function renKode(kilde: string): string {
  return kilde
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')
}

const kilde = renKode(readFileSync(FIL, 'utf8'))

function antall(s: string, del: string): number {
  let n = 0
  for (let i = s.indexOf(del); i !== -1; i = s.indexOf(del, i + del.length)) n++
  return n
}

// ── Redirectene ─────────────────────────────────────────────────────────────

test('nøyaktig én router.replace — kun manglende session_id (direkte besøk)', () => {
  // Én teller for ALLE fem feilveiene: legges en redirect tilbake i hvilken
  // som helst gren (!res.ok, paid=false, kastende fetch, manglende sesjon,
  // timeout), blir telleren 2 og denne feller det — uavhengig av ordlyd.
  assert.equal(
    antall(kilde, 'router.replace'), 1,
    'fila har mer enn én router.replace — en feilvei har fått tilbake en redirect bort fra kvitteringen',
  )
  assert.ok(
    kilde.includes("if (!sessionId) { router.replace('/premium'); return }"),
    'den ene tillatte redirecten (manglende session_id → salgssiden) har endret form — verifiser at den fortsatt kun gjelder direkte besøk uten session_id',
  )
})

test('ingen /login-redirect — innlogging tilbys som lenke, ikke tvang', () => {
  assert.ok(
    !kilde.includes("router.replace('/login"),
    'siden redirecter til /login igjen — en betalende kunde skal få omforsøket og deretter en lenke, ikke kastes ut av kvitteringen',
  )
})

// ── Feilgrenene setter tilstand i stedet for å navigere ─────────────────────

test('!res.ok og paid=false ender i ukjent-tilstanden', () => {
  assert.equal(
    antall(kilde, "else setLoadState('ukjent')"), 1,
    'grenen for res.ok=false / paid=false setter ikke lenger ukjent-tilstanden',
  )
})

test('kastende fetch ender i ukjent-tilstanden', () => {
  // Ankeret er catch-blokkens EGEN form (med !cancelled-vakt) — den skiller
  // seg fra else-grenen over, så de to kan ikke oppfylle hverandres test.
  assert.equal(
    antall(kilde, "catch {\n        if (!cancelled) setLoadState('ukjent')"), 1,
    'catch-grenen (offline, DNS, timeout i fetch) setter ikke lenger ukjent-tilstanden',
  )
})

test('manglende sesjon ender i nosession-tilstanden', () => {
  assert.equal(
    antall(kilde, "if (!session?.access_token) { setLoadState('nosession'); return }"), 1,
    'grenen for manglende sesjon setter ikke lenger nosession-tilstanden',
  )
})

// ── Hengemulighetene ────────────────────────────────────────────────────────

test('getSession ligger inne i try-blokken', () => {
  // Posisjonelt, ikke bare «finnes»: kaster getSession() utenfor try, henger
  // 'verifying' for alltid. try må åpne FØR første getSession-kall.
  const tryPos = kilde.indexOf('try {')
  const getSessionPos = kilde.indexOf('supabase.auth.getSession()')
  assert.ok(tryPos !== -1, 'fant ingen try-blokk i verify')
  assert.ok(getSessionPos !== -1, 'fant ingen getSession i verify')
  assert.ok(
    tryPos < getSessionPos,
    'getSession() kalles FØR try åpner — kaster den, blir siden stående i «Aktiverer Premium…» for alltid',
  )
})

test('omforsøk på sesjonshydrering — samme form som /historikk og /liga', () => {
  assert.equal(
    antall(kilde, 'supabase.auth.getSession()'), 2,
    'omforsøket etter 500 ms er borte — løpet mellom Supabase-hydrering fra localStorage og første getSession() sender kunden til nosession uten grunn',
  )
  assert.equal(
    antall(kilde, 'setTimeout(resolve, 500)'), 1,
    'ventepausen mellom de to getSession-kallene er borte eller har endret form',
  )
})

test('hard timeout avløser verifying', () => {
  assert.equal(
    antall(kilde, 'setTimeout(() => {'), 1,
    'hard-timeren er borte — et hengende kall kan igjen holde «Aktiverer Premium…» for alltid',
  )
  assert.ok(
    kilde.includes('}, HARD_TIMEOUT_MS)'),
    'hard-timeren bruker ikke HARD_TIMEOUT_MS-konstanten',
  )
})

test('hard-timeren rører kun verifying — nedgraderer aldri paid/nosession', () => {
  assert.equal(
    antall(kilde, "setLoadState(prev => (prev === 'verifying' ? 'ukjent' : prev))"), 1,
    'timerens funksjonelle vakt er borte — da kan et sent timeravfyr overskrive en kvittering som allerede vises',
  )
})

test('hard-timeren ryddes i cleanup', () => {
  assert.equal(
    antall(kilde, 'clearTimeout(hardTimer)'), 1,
    'hard-timeren ryddes ikke i effektens cleanup — den kan da fyre mot en avmontert komponent eller på tvers av omforsøk',
  )
})

// ── Veien videre ────────────────────────────────────────────────────────────

test('login-lenken bærer encodet next tilbake til kvitteringen', () => {
  assert.ok(
    kilde.includes('/login?next=${encodeURIComponent('),
    'login-lenken mangler encodet ?next= — etter innlogging skal kunden tilbake til kvitteringen, og session_id-parameteren overlever kun encodet',
  )
})
