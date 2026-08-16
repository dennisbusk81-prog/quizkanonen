import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { acquireResendSlot } from '@/lib/resend-budget'

const resend = new Resend(process.env.RESEND_API_KEY!)

export type SendEmailOptions = {
  to: string | string[]
  subject: string
  html: string
  from?: string
  replyTo?: string
}

// ── Hvorfor Sentry-rapporteringen bor HER og ikke hos kallerne ───────────────
//
// 12. august 2026: en aktivering av prøveperioden gikk gjennom, men
// `trialWelcomeEmail` feilet med «API key is invalid». Brukeren fikk ingenting,
// og det eneste sporet var en `console.error` — som ingen leser i prod.
//
// Feilen har 24 søsken. Det finnes 25 kallsteder for sendEmail: 11 med
// fire-and-forget `.catch(err => console.error(...))`, resten med await inne i
// en try/catch som logger på samme måte. INGEN av dem rapporterte noe sted en
// e-postfeil faktisk kunne oppdages. Å instrumentere 25 steder ville dessuten
// etterlatt nøyaktig det hullet et 26. kallsted åpner igjen.
//
// Derfor ved SINKET, samme mønster som escapingen i lib/email-templates.ts og
// skrubbingen i lib/sentry-scrub.ts: kallerne kan ikke glemme det, fordi de
// ikke er involvert. `console.error` hos kallerne beholdes — den er fortsatt
// det raskeste sporet i en lokal `npm run dev`.
//
// Fire-and-forget-oppførselen er UENDRET: vi kaster som før, kallerne fanger
// som før, og ingen aktivering, webhook eller cron begynner å feile fordi en
// e-post ikke gikk ut. Det eneste nye er at feilen blir synlig.
//
// Mottakeradressen sendes bevisst IKKE med. `scrubEvent` ville riktignok
// fjernet den (den skrubber også `extra`), men en personopplysning som aldri
// forlater prosessen kan ikke lekke gjennom en framtidig endring i skrubbingen.
// `subject` er vår egen tekst og trygg — den er dessuten den raskeste måten å
// se HVILKEN e-post som feilet.
function rapporter(err: unknown, subject: string, detaljer: Record<string, unknown> = {}) {
  Sentry.captureException(err, {
    tags: { area: 'email' },
    extra: { subject, ...detaljer },
  })
}

export async function sendEmail({
  to,
  subject,
  html,
  from = 'Quizkanonen <hei@quizkanonen.no>',
  replyTo,
}: SendEmailOptions): Promise<void> {
  // ── Delt 10/s-budsjett mot Resend (lib/resend-budget.ts) ──────────────────
  //
  // Gaten ligger HER og ikke i dispatchInBatches, fordi 21 av 25 kallsteder
  // går utenom batchehjelperen (sendEmailToMany, send-invite med opptil 50
  // samtidige, Stripe-webhooken, alle enkeltsendingene). Ved sinket arver alle
  // den — samme mønster som Sentry-rapporteringen under.
  //
  // Er sekundet fullt, VENTER acquireResendSlot til neste sekundgrense (maks
  // ~10 s, se MAX_WAIT_ROUNDS). Gir den opp, kaster vi samme feilform som et
  // Resend-429 gir i dag — kallernes håndtering (ikke stemple, prøv neste
  // kjøring) er dermed uendret, bare at feilen nå oppstår FØR kallet i stedet
  // for som avvisning fra Resend.
  const slot = await acquireResendSlot()
  if (!slot.ok) {
    const err = new Error(
      'Failed to send email: delt Resend-budsjett (10/s) fortsatt fullt etter maks venting'
    )
    rapporter(err, subject, { kilde: 'resend-budsjett gav opp' })
    throw err
  }

  let error: { message: string; name?: string } | null = null

  try {
    ({ error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    }))
  } catch (thrown) {
    // Resend KASTER ved nettverksfeil/timeout i stedet for å returnere `error`.
    // Uten denne grenen ville den vanligste driftsfeilen — Resend utilgjengelig
    // — vært den ene som ikke ble rapportert.
    rapporter(thrown, subject, { kilde: 'resend.emails.send kastet' })
    throw thrown
  }

  if (error) {
    const err = new Error(`Failed to send email: ${error.message}`)
    rapporter(err, subject, { kilde: 'resend svarte med error', resendError: error.name ?? null })
    throw err
  }
}
