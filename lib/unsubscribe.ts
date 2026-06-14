import { createHmac, timingSafeEqual } from 'crypto'

export type UnsubscribeType = 'reminders' | 'reengagement' | 'duel'

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
