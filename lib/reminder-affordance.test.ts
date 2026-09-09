// Kjøres med:  npm test
//   enkelt:    node --import ./scripts/ts-node-resolve.mjs --test lib/reminder-affordance.test.ts
//
// N-29 — «Få e-post når quizen åpner» på forsidens KOMMENDE-kort, for
// INNLOGGEDE. To halvdeler:
//
//   1) BESLUTNINGEN (lib/reminder-affordance.ts) — tre tilstander, og den
//      tredje er hele saken: er profilen ikke lest, er svaret null. Ikke
//      'off', ikke en tom streng.
//   2) KOBLINGEN (app/page.tsx) — at null faktisk rendrer INGEN linje, at
//      lenken kun står bak 'off', og at feilvakten linja henger på er den
//      samme som Premium-teksten bruker (premiumUnknown).
//
// Strukturdelen er tekstlig fordi en server-komponent ikke kan rendres under
// node --test (loaderen stripper typer, ikke JSX) — med AKTIVE linjer som
// anker, så en utkommentert gren ikke teller.
//
// MUTASJONSBEVIS (9. september 2026):
//   • `if (input.profileUnknown) return null` → `return 'off'`
//        → «profil-lesefeil gir INGEN linje» rød
//   • `if (!input.profile) return null` → `return 'off'`
//        → «tomt svar er også ukjent» rød
//   • i app/page.tsx: `) : null}` byttet ut med en gren som rendrer lenken
//        → «ukjent-grenen rendrer INGENTING» rød
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { decideReminderLine } from './reminder-affordance'

// ── 1) Beslutningen ─────────────────────────────────────────────────────────

test('bryter PÅ → «du får e-post»-tilstanden', () => {
  assert.equal(decideReminderLine({ profileUnknown: false, profile: { email_reminders: true } }), 'on')
})

test('bryter AV → tilbudet om å skru den på', () => {
  assert.equal(decideReminderLine({ profileUnknown: false, profile: { email_reminders: false } }), 'off')
})

test('NULL i kolonnen er «av» — send-reminders filtrerer på = true, så tilbudet er sant', () => {
  assert.equal(decideReminderLine({ profileUnknown: false, profile: { email_reminders: null } }), 'off')
})

test('profil-lesefeil gir INGEN linje — ikke tilbudet', () => {
  const linje = decideReminderLine({ profileUnknown: true, profile: { email_reminders: false } })
  // Nøyaktig null: verken 'off' (en usann påstand overfor en som HAR varselet
  // på) eller en tom streng (som ville rendret et tomt avsnitt).
  assert.equal(linje, null)
})

test('feilvakten slår ut selv om en profilrad skulle ligge der fra før', () => {
  assert.equal(decideReminderLine({ profileUnknown: true, profile: { email_reminders: true } }), null)
})

test('tomt svar er også ukjent — ingen rad, ingen bryter å påstå noe om', () => {
  assert.equal(decideReminderLine({ profileUnknown: false, profile: null }), null)
})

test('manglende kolonne (undefined) er ukjent, ikke «av»', () => {
  // Faller den til 'off' her, gjør en fjernet kolonne i select-lista linja til
  // en stille løgn overfor alle som har varselet PÅ.
  assert.equal(decideReminderLine({ profileUnknown: false, profile: {} }), null)
})

// ── 2) Koblingen på forsiden ────────────────────────────────────────────────

function les(rel: string): string {
  const raw = readFileSync(path.join(process.cwd(), rel), 'utf8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

/** Kun linjer som faktisk kjører — en utkommentert gren skal ikke telle. */
function aktiveLinjer(kropp: string): string {
  return kropp
    .split('\n')
    .filter(l => {
      const t = l.trim()
      return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*')
    })
    .join('\n')
}

const PAGE = aktiveLinjer(les('app/page.tsx'))
const PROFIL = aktiveLinjer(les('app/profil/page.tsx'))

const TILBUD = 'Få e-post når quizen åpner →'
const BEKREFTELSE = 'Du får e-post når quizen åpner.'
const START = "{reminderLine === 'on' ? ("
const UKJENT = ') : null}'

test('forsiden henter flagget i den eksisterende profil-spørringen — ikke i et nytt kall', () => {
  const i = PAGE.indexOf(".select('display_name, premium_status")
  assert.ok(i > 0, 'fant ikke forsidens profil-select')
  const select = PAGE.slice(i, PAGE.indexOf(')', i))
  assert.ok(select.includes('email_reminders'), 'email_reminders mangler i profil-selecten')
  // Ingen ny spørring mot profiles for flagget: forsiden skal fortsatt ha
  // nøyaktig de to den hadde (founders-tellingen + profilraden).
  assert.equal(PAGE.split(".from('profiles')").length - 1, 2)
})

test('linja henger på SAMME feilvakt som Premium-teksten (premiumUnknown)', () => {
  assert.ok(
    PAGE.includes('const reminderLine = decideReminderLine({ profileUnknown: premiumUnknown, profile })'),
    'reminderLine skal utledes av decideReminderLine med forsidens egen lesevakt',
  )
  assert.ok(PAGE.includes("import { decideReminderLine } from '@/lib/reminder-affordance'"))
})

test('tilbudet står bak «av», bekreftelsen bak «på», og ukjent-grenen rendrer INGENTING', () => {
  const start = PAGE.indexOf(START)
  assert.ok(start > 0, 'fant ikke varslingslinja i kommende-kortet')
  const slutt = PAGE.indexOf(UKJENT, start)
  assert.ok(slutt > start, 'ukjent-grenen ender ikke i `) : null}` — noe rendres ved ukjent tilstand')
  const blokk = PAGE.slice(start, slutt + UKJENT.length)

  assert.ok(blokk.includes(BEKREFTELSE), 'bekreftelsesteksten mangler')
  assert.ok(blokk.includes(TILBUD), 'tilbudsteksten mangler')
  assert.ok(blokk.includes("reminderLine === 'off' ? ("), 'tilbudet er ikke gatet på «av»')
  // Bekreftelsen er REN TEKST: ingen lenke før 'off'-grenen begynner.
  const påGren = blokk.slice(0, blokk.indexOf("reminderLine === 'off'"))
  assert.ok(!påGren.includes('<Link'), 'bekreftelsen skal ikke være en lenke')
  assert.ok(blokk.includes('href="/profil#varsler"'), 'tilbudet peker ikke på varslingsvalget')

  // Ingen av de to tekstene finnes utenfor blokka — en kopi et annet sted
  // ville kunne rendres uten gate.
  assert.equal(PAGE.split(TILBUD).length - 1, 1, 'tilbudsteksten skal stå nøyaktig ett sted')
  assert.equal(PAGE.split(BEKREFTELSE).length - 1, 1, 'bekreftelsesteksten skal stå nøyaktig ett sted')
})

test('lenkemålet finnes — /profil har ankeret varslingskortet lenkes til', () => {
  assert.ok(PROFIL.includes('id="varsler"'), 'ankeret #varsler mangler på profilsiden')
})

test('linja er ikke gull — kortet har allerede sin ene gule CTA', () => {
  const start = PAGE.indexOf(START)
  const blokk = PAGE.slice(start, PAGE.indexOf(UKJENT, start))
  assert.ok(!blokk.includes('qk-btn-primary'), 'varslingslinja skal ikke være en gul knapp')
  assert.ok(!blokk.includes('#c9a84c'), 'varslingslinja skal ikke ha hardkodet gull')
})

test('den ANONYME grenen er urørt — den peker fortsatt til /login', () => {
  const i = PAGE.indexOf('Få påminnelse på e-post →')
  assert.ok(i > 0, 'den anonyme påminnelseslenken er borte')
  assert.ok(
    PAGE.slice(Math.max(0, i - 400), i).includes('href="/login"'),
    'den anonyme lenken peker ikke lenger til /login (der kontoen opprettes)',
  )
})
