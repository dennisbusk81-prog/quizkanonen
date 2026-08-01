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
