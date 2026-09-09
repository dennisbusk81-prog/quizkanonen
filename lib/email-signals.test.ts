// Kjøres med:  npm test
//
// STRUKTURELL SPERRE: e-postsignalene bedriftsfiltre vekter.
//
// Kartleggingen 9. september 2026 (bekreftelsesmail flagget som phishing hos
// en M365-bedrift) fant at SPF, DKIM og DMARC-justering var i orden, og at det
// som sto igjen i repoet var små signaler som teller SAMMEN når domenet er
// under seks måneder gammelt. Malene er tekst, ikke logikk, så sperren er en
// kildetekst-test — samme begrunnelse som lib/navnepolicy-etiketter.test.ts.
//
// ── DEL A: ingen lenke i e-post skal peke på apex-domenet ───────────────────
// quizkanonen.no svarer 307 til www.quizkanonen.no. Microsoft Safe Links og
// tilsvarende gatewayer følger lenken før brukeren klikker og ser et
// omdirigert klikkmål — ett av signalene de vekter. Lenkene skal derfor peke
// DIREKTE på www. Filene som voktes er de som produserer e-post-HTML; websider
// (app/vilkar m.fl.) er utenfor, en apex-lenke på en nettside er ikke et
// e-postsignal.
//
// Hvorfor ikke en delt konstant/env: NEXT_PUBLIC_SITE_URL finnes, men verdien
// er ikke verifiserbar lokalt (ikke i .env.local) og Supabase sin SITE_URL er
// apex — en env-styrt base kunne gjeninnført hoppet stille. Å gjøre malene
// env-avhengige er en egen beslutning; inntil da er www hardkodet, som de 25
// lenkene som alt pekte riktig.
//
// ── DEL B: ingen ekstern ressurs i e-post-HTML ──────────────────────────────
// 32 av 33 maler hadde <link rel="stylesheet"> mot fonts.googleapis.com i
// <head>. Gmail stripper <link>, Outlook ignorerer den — men gatewayer teller
// den som «remote content» fra en tredjepart. Fonten ble reelt bare lastet i
// Apple Mail/iOS Mail. Lenken er fjernet; hver font-family beholder en
// generisk fallback (Arial/Georgia + sans-serif/serif), som er det Gmail og
// Outlook alltid har rendret. Ingen mal avhenger av at fonten lastes:
// layouten er tabeller med fast padding, ikke fontmetrikk.
//
// MUTASJONSBEVIS:
//   • Del A: én www-lenke i lib/email-templates.ts skrives tilbake til apex →
//     «ingen e-postlenke peker på apex» ryker og navngir fila.
//   • Del B: <link>-linja settes tilbake i én mal → «ingen ekstern ressurs»
//     ryker; fallbacken strykes fra én font-family («'Instrument Sans'» alene)
//     → «hver font-family har generisk fallback» ryker og siterer verdien.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

// Filer som produserer e-post-HTML. send-reminder-ruten har en inline-mal
// utenfor lib/email-templates.ts — søsken med samme form, derfor med.
const EMAIL_SOURCES = [
  'lib/email-templates.ts',
  'app/api/org/[slug]/send-reminder/route.ts',
]

function les(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

// Apex = «https://quizkanonen.no» etterfulgt av sti, anførselstegn eller
// slutt — IKKE «https://www.quizkanonen.no» (www. står mellom // og navnet).
const APEX = /https:\/\/quizkanonen\.no(?=[/"'\s)]|$)/g

test('DEL A: ingen e-postlenke peker på apex-domenet (307 → www)', () => {
  for (const rel of EMAIL_SOURCES) {
    const src = les(rel)
    const treff = src.match(APEX) ?? []
    assert.equal(treff.length, 0,
      `${rel}: ${treff.length} lenke(r) peker på https://quizkanonen.no — skal være https://www.quizkanonen.no`)
  }
})

test('DEL A: malene peker faktisk på www (sanity — fila er lest og har lenker)', () => {
  const src = les('lib/email-templates.ts')
  const www = src.match(/https:\/\/www\.quizkanonen\.no/g) ?? []
  assert.ok(www.length >= 40, `ventet ≥40 www-lenker i malene, fant ${www.length}`)
})

test('DEL B: ingen ekstern ressurs i e-post-HTML (ingen <link>, ingen fonts.googleapis)', () => {
  for (const rel of EMAIL_SOURCES) {
    const src = les(rel)
    const fonts = src.match(/fonts\.googleapis\.com/g) ?? []
    const links = src.match(/<link\s/g) ?? []
    assert.equal(fonts.length, 0, `${rel}: ${fonts.length} referanse(r) til fonts.googleapis.com`)
    assert.equal(links.length, 0, `${rel}: ${links.length} <link>-element(er) — e-post skal ikke laste eksterne ressurser`)
  }
})

test('DEL B: hver font-family i malene har generisk fallback (serif/sans-serif)', () => {
  const src = les('lib/email-templates.ts')
  const deklarasjoner = [...src.matchAll(/font-family:([^;"]+)/g)].map(m => m[1].trim())
  assert.ok(deklarasjoner.length >= 100, `ventet ≥100 font-family-deklarasjoner, fant ${deklarasjoner.length}`)

  const utenFallback = deklarasjoner.filter(v => !/(^|,)\s*(sans-)?serif$/.test(v))
  assert.deepEqual(utenFallback, [],
    `font-family uten generisk fallback — uten webfont-lasting er fallbacken det som faktisk vises`)
})

// ── DEL C: List-Unsubscribe på repeterende, ALDRI på transaksjonelle ────────
//
// Repeterende = maler brukeren kan melde seg av, og som har en FUNGERENDE
// avmeldingsvei (HMAC-lenke → app/api/notifications/unsubscribe):
//   quizReminderEmail   → type 'reminders'     (cron/send-reminders)
//   quizOpenedEmail     → type 'quiznotify'    (cron/notify-subscribers)
//   reEngagementEmail   → type 'reengagement'  (cron/re-engagement)
//   duelInviteEmail     → type 'duel'          (rivalries POST)
// Alt annet er transaksjonelt (bekreftelse, kvittering, passord, betaling,
// org-livssyklus) og skal IKKE ha headeren — en avmeldingslenke på en
// passord-e-post er en egen bug. weeklyReportEmail og orgCloseReminderEmail
// er repeterende, men har INGEN avmeldingsvei i dag; de står derfor bevisst
// utenfor lista til en slik vei finnes (egen sak). En header som peker på noe
// som ikke virker er verre enn ingen header.
//
// Testen skanner hvert `sendEmail(`-kall i app/ og lib/ (paren-balansert) og
// ser på kallet pluss de 12 linjene foran (der `const html = xEmail(…)` ofte
// står). Regelen er per kall, i begge retninger:
//   repeterende mal i vinduet  ⇒  `headers: listUnsubscribeHeaders(` i kallet
//   ingen repeterende mal      ⇒  ingen `headers:` og ingen listUnsubscribeHeaders
//
// MUTASJONSBEVIS:
//   • `headers: listUnsubscribeHeaders(unsubUrl),` fjernet fra
//     cron/send-reminders → «repeterende utsendinger har List-Unsubscribe»
//     ryker og navngir fila.
//   • `headers: listUnsubscribeHeaders(…)` lagt inn i velkomstmailen i
//     lib/auth-post-login.ts → «transaksjonelle e-poster har ALDRI
//     List-Unsubscribe» ryker og navngir fila.

import { readdirSync, statSync } from 'node:fs'

const REPEATING_TEMPLATES = ['quizReminderEmail', 'quizOpenedEmail', 'reEngagementEmail', 'duelInviteEmail']
const WINDOW_LINES = 12

function kildefiler(dir: string): string[] {
  const ut: string[] = []
  for (const navn of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${navn}`
    if (navn === 'node_modules' || navn.startsWith('.')) continue
    if (statSync(join(ROOT, rel)).isDirectory()) { ut.push(...kildefiler(rel)); continue }
    if (!/\.(ts|tsx)$/.test(navn) || /\.test\.ts$/.test(navn)) continue
    if (rel === 'lib/email.ts') continue // definisjonen, ikke et kallsted
    ut.push(rel)
  }
  return ut
}

/** Finner hvert `sendEmail(` og returnerer kallteksten (balansert) + vinduet foran. */
function sendEmailKall(src: string): { kall: string; vindu: string; linje: number }[] {
  const funn: { kall: string; vindu: string; linje: number }[] = []
  const re = /\bsendEmail\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const start = m.index + m[0].length - 1 // posisjonen til '('
    let dybde = 0, i = start, streng: string | null = null
    for (; i < src.length; i++) {
      const c = src[i]
      if (streng) { if (c === '\\') { i++; continue } if (c === streng) streng = null; continue }
      if (c === '\'' || c === '"' || c === '`') { streng = c; continue }
      if (c === '(') dybde++
      else if (c === ')' && --dybde === 0) break
    }
    const kall = src.slice(m.index, i + 1)
    const før = src.slice(0, m.index).split('\n')
    const vindu = før.slice(-WINDOW_LINES).join('\n') + '\n' + kall
    funn.push({ kall, vindu, linje: før.length })
  }
  return funn
}

const ALLE_KALL = [...kildefiler('app'), ...kildefiler('lib')]
  .flatMap(rel => sendEmailKall(les(rel)).map(k => ({ rel, ...k })))

test('DEL C: skanneren finner kallstedene (sanity)', () => {
  assert.ok(ALLE_KALL.length >= 20, `ventet ≥20 sendEmail-kall i app/ og lib/, fant ${ALLE_KALL.length}`)
  const repeterende = ALLE_KALL.filter(k => REPEATING_TEMPLATES.some(t => k.vindu.includes(t)))
  assert.equal(repeterende.length, REPEATING_TEMPLATES.length,
    `ventet ett kallsted per repeterende mal, fant ${repeterende.length}: ${repeterende.map(k => `${k.rel}:${k.linje}`).join(', ')}`)
})

test('DEL C: repeterende utsendinger har List-Unsubscribe via listUnsubscribeHeaders', () => {
  const mangler = ALLE_KALL
    .filter(k => REPEATING_TEMPLATES.some(t => k.vindu.includes(t)))
    .filter(k => !/headers:\s*listUnsubscribeHeaders\(/.test(k.kall))
    .map(k => `${k.rel}:${k.linje}`)
  assert.deepEqual(mangler, [], 'repeterende utsending uten List-Unsubscribe-header')
})

test('DEL C: transaksjonelle e-poster har ALDRI List-Unsubscribe', () => {
  const feil = ALLE_KALL
    .filter(k => !REPEATING_TEMPLATES.some(t => k.vindu.includes(t)))
    .filter(k => /\bheaders\s*:/.test(k.kall) || /listUnsubscribeHeaders|List-Unsubscribe/.test(k.vindu))
    .map(k => `${k.rel}:${k.linje}`)
  assert.deepEqual(feil, [],
    'transaksjonell e-post med avmeldingsheader — en avmeldingslenke på en kvittering/passord-e-post er en egen bug')
})
