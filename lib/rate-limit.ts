const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { success: boolean; remaining: number } {
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || now > entry.resetAt) {
    // FIX 7 — delete the stale entry so the Map doesn't grow unbounded
    if (entry) rateLimitMap.delete(key)
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs })
    return { success: true, remaining: limit - 1 }
  }

  if (entry.count >= limit) {
    rateLimitMap.delete(key)
    return { success: false, remaining: 0 }
  }

  entry.count++
  return { success: true, remaining: limit - entry.count }
}
