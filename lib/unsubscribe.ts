import { createHmac, timingSafeEqual } from 'crypto'

// `quiznotify` skiller seg fra de tre andre: den gjelder e-postlisten for
// UINNLOGGEDE (tabellen `quiz_notifications`), ikke en kolonne på `profiles`.
// Id-en i tokenet er derfor rad-id-en i den tabellen, ikke en bruker-id — se
// COLUMN_MAP/POST i app/api/notifications/unsubscribe/route.ts. Rad-id brukes
// bevisst framfor e-postadressen: adressen er PII og skal ikke ligge i en URL.
//
// `weeklyreport` og `orgclose` kom til 9. september 2026 — de to repeterende
// e-postene som fram til da bare pekte på /profil i teksten og derfor ikke
// kunne få List-Unsubscribe. Begge er profilbaserte som de tre første; id-en
// er bruker-id-en, og kolonnene de styrer er `email_weekly_report` og
// `email_org_reminders` (migrasjon 20260909000001).
export type UnsubscribeType =
  | 'reminders'
  | 'reengagement'
  | 'duel'
  | 'quiznotify'
  | 'weeklyreport'
  | 'orgclose'

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

// www, ALLTID — ikke NEXT_PUBLIC_SITE_URL. Verdien i prod er apex
// (`https://quizkanonen.no`), som svarer 307 til www. RFC 8058 sier at
// avsenderen IKKE skal svare med redirect på one-click-POST-en, fordi
// redirectede POST-er historisk ikke virker pålitelig: «Avslutt
// abonnement»-knappen i Gmail kunne feile stille, mens lenken i bunnteksten
// så ut til å virke (nettleseren følger 307 på GET). Gjelder alle seks
// avmeldingstypene — de deler denne ene byggeren.
//
// Basen er hardkodet HER, ikke hentet fra env og ikke løftet til en delt
// konstant: en env-styrt base er nettopp det som gjeninnførte hoppet stille.
// Samme valg og samme begrunnelse som www-lenkene i lib/email-templates.ts
// — se DEL A i lib/email-signals.test.ts.
const UNSUBSCRIBE_BASE = 'https://www.quizkanonen.no'

export function buildUnsubscribeUrl(userId: string, type: UnsubscribeType): string {
  const token = generateUnsubscribeToken(userId, type)
  return `${UNSUBSCRIBE_BASE}/api/notifications/unsubscribe?token=${token}&type=${encodeURIComponent(type)}&uid=${encodeURIComponent(userId)}`
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
