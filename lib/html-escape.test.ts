// Kjøres med:  npm test
//
// Dekker escapeHtml og — viktigere — at e-postmalene faktisk BRUKER den.
// Malene er sinket: escaper de ikke, går angriper-skrevet markup ut fra
// hei@quizkanonen.no.
//
// MUTASJONSBEVIS: fjernes escapeHtml() fra orgInviteEmail, inneholder resultatet
// «<script» og assert-en under feiler.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml } from './html-escape'
import {
  orgInviteEmail,
  orgTrialEmail,
  weeklyReportEmail,
  duelInviteEmail,
  orgWelcomeEmail,
} from './email-templates'

const XSS = '<script>alert(1)</script>'
const ATTR_BREAK = '"><img src=x onerror=alert(1)>'

test('escapeHtml escaper alle fem tegnene', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
})

test('escapeHtml håndterer null/undefined som tom streng', () => {
  assert.equal(escapeHtml(null), '')
  assert.equal(escapeHtml(undefined), '')
})

test('escapeHtml lar vanlige norske navn stå urørt', () => {
  assert.equal(escapeHtml('Elkjøp Nordic'), 'Elkjøp Nordic')
  assert.equal(escapeHtml('Ole-Martin Ødegård'), 'Ole-Martin Ødegård')
})

test('orgInviteEmail tolker ikke avsendernavn eller org-navn som markup', () => {
  const html = orgInviteEmail(XSS, ATTR_BREAK, 'https://quizkanonen.no/bli-med/abc')

  assert.ok(!html.includes('<script'), 'script-tag lekket inn i malen')
  assert.ok(!html.includes('<img'), 'img-tag lekket inn i malen')
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'navnet skal vises som ren tekst')

  // Lenken vi bygger selv skal fortsatt være en fungerende href.
  assert.ok(html.includes('href="https://quizkanonen.no/bli-med/abc"'))
})

test('legitime navn er uendret i orgInviteEmail', () => {
  const html = orgInviteEmail('Dennis Busk', 'Elkjøp Nordic', 'https://quizkanonen.no/bli-med/abc')
  assert.ok(html.includes('>Dennis Busk</strong>'))
  assert.ok(html.includes('>Elkjøp Nordic</strong>'))
})

test('org-navn escapes i de øvrige org-malene', () => {
  for (const html of [
    orgTrialEmail(XSS, 'abc123', '2026-08-18T01:34:54Z'),
    orgWelcomeEmail(XSS, XSS, 'abc123', true),
  ]) {
    assert.ok(!html.includes('<script'))
  }
})

test('weeklyReportEmail escaper spillernavn fra attempts.player_name', () => {
  // displayName kan komme fra fritekst-feltet player_name, ikke bare fra den
  // validerte profilen — se lib/weekly-report.ts.
  const html = weeklyReportEmail({
    orgName: 'Elkjøp Nordic',
    winner: { displayName: XSS, correct: 9, total: 10 },
    top3: [
      { displayName: XSS, correct: 9, total: 10 },
      { displayName: ATTR_BREAK, correct: 8, total: 10 },
    ],
    participantCount: 12,
    shareText: '🏆 Ukens vinner: <b>x</b>\nNeste fredag?',
  })

  assert.ok(!html.includes('<script'), 'script-tag lekket inn via displayName')
  assert.ok(!html.includes('<img'), 'img-tag lekket inn via displayName')
  assert.ok(!html.includes('<b>x</b>'), 'markup lekket inn via shareText')
  assert.ok(html.includes('<br />'), 'linjeskift i shareText skal fortsatt bli <br />')
})

test('duelInviteEmail escaper utfordrernavn', () => {
  const html = duelInviteEmail(XSS)
  assert.ok(!html.includes('<script'))
})
