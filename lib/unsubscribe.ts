import { createHmac, timingSafeEqual } from 'crypto'

// `quiznotify` skiller seg fra de tre andre: den gjelder e-postlisten for
// UINNLOGGEDE (tabellen `quiz_notifications`), ikke en kolonne på `profiles`.
// Id-en i tokenet er derfor rad-id-en i den tabellen, ikke en bruker-id — se
// COLUMN_MAP/POST i app/api/notifications/unsubscribe/route.ts. Rad-id brukes
// bevisst framfor e-postadressen: adressen er PII og skal ikke ligge i en URL.
export type UnsubscribeType = 'reminders' | 'reengagement' | 'duel' | 'quiznotify'

function secret(): string {
  return process.env.CRON_SECRET ?? ''
}

export function generateUnsubscribeToken(userId: string, type: UnsubscribeType): string {
  return createHmac('sha256', secret()).update(`${userId}:${type}`).digest('hex')
}

export function verifyUnsubscribeToken(userId: string, type: UnsubscribeType, token: string): boolean {
  const expected = generateUnsubscribeToken(userId, type)
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'))
  } catch {
    return false
  }
}

export function buildUnsubscribeUrl(userId: string, type: UnsubscribeType): string {
  const token = generateUnsubscribeToken(userId, type)
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.quizkanonen.no').replace(/\/$/, '')
  return `${base}/api/notifications/unsubscribe?token=${token}&type=${encodeURIComponent(type)}&uid=${encodeURIComponent(userId)}`
}

/**
 * SMTP-headerne som lar mottakerens e-postklient tilby «Avslutt abonnement»
 * i selve klienten (RFC 2369 + RFC 8058 one-click), og som bedriftsfiltre
 * vekter positivt for repeterende post.
 *
 * URL-en skal være den SAMME som avmeldingslenken i bunnen av e-posten —
 * `buildUnsubscribeUrl()` — så headeren peker på noe som beviselig virker:
 *   • Klienten åpner lenken (GET) → bekreftelsesside, ingen skriving.
 *   • Klienten sender one-click (POST med body `List-Unsubscribe=One-Click`)
 *     → `postParams` i app/api/notifications/unsubscribe/route.ts finner ingen
 *     token/type/uid i skjemaet og faller tilbake på query-strengen → avmeldt.
 *     Den fallbacken er dermed ikke lenger bare en reserve; den er kontrakten
 *     denne headeren hviler på, og den er testdekket i
 *     lib/unsubscribe-route.test.ts.
 *
 * Kun HTTPS-varianten, ingen mailto: — vi har ingen innkommende
 * e-postbehandling, og en mailto som ikke leses er verre enn ingen.
 *
 * Brukes KUN på repeterende utsendinger. Se kommentaren på
 * `SendEmailOptions.headers` i lib/email.ts for skillet mot transaksjonelt.
 */
export function listUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
