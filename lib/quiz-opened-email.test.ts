// Kjøres med:  npm test
//
// Malen som går til e-postlisten for UINNLOGGEDE (quiz_notifications), sendt av
// /api/cron/notify-subscribers.
//
// To ting låses her:
//   1. Avmeldingslenken MÅ stå i bunnen. Mottakeren har ingen konto, så
//      profilsiden er ingen utvei — uten lenken har de ingen vei ut i det hele
//      tatt, og e-posten sier likevel «du meldte deg på».
//   2. Quiz-tittelen escapes i MALEN («escape ved sinket», se toppen av
//      lib/email-templates.ts), ikke hos kalleren. Tittelen er admin-skrevet i
//      dag, så dette lukker et konsistensgap framfor en kjent angrepsvei — men
//      regelen finnes nettopp for at neste kaller ikke skal måtte huske noe.
//
// MUTASJONSBEVIS: fjern escapeHtml() rundt tittelen → escape-testen feiler;
// fjern unsubscribeRow-linjen → begge lenke-testene feiler.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { quizOpenedEmail } = await import('@/lib/email-templates')

const UNSUB = 'https://www.quizkanonen.no/api/notifications/unsubscribe?token=abc123&type=quiznotify&uid=42'

test('avmeldingslenken står i e-posten', async () => {
  const html = quizOpenedEmail('Ukens quiz', UNSUB)

  assert.ok(html.includes(`href="${UNSUB}"`), 'lenken skal stå urørt, med & mellom query-parametere')
  assert.match(html, /Avslutt abonnement/)
})

test('avmeldingslenken står der også når quizen mangler tittel', async () => {
  const html = quizOpenedEmail(null, UNSUB)
  assert.ok(html.includes(`href="${UNSUB}"`))
})

test('quiz-tittelen escapes i malen', async () => {
  const html = quizOpenedEmail('<script>alert(1)</script>', UNSUB)

  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;/)
})

test('ufarlige tegn i tittelen overlever lesbart', async () => {
  const html = quizOpenedEmail('Quiz & Co', UNSUB)
  assert.match(html, /Quiz &amp; Co/)
})

test('tittel-avsnittet utelates helt når tittelen mangler', async () => {
  const withTitle = quizOpenedEmail('Fredagsquiz', UNSUB)
  const without   = quizOpenedEmail(undefined, UNSUB)

  assert.match(withTitle, /Fredagsquiz/)
  assert.ok(without.length < withTitle.length)
})
