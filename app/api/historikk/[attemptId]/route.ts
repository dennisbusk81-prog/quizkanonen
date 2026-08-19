import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getUserPremium } from '@/lib/premium-check'
import { getAttemptDetail } from '@/lib/history'
import type { AttemptDetail } from '@/lib/history'

// Verify and decode a Supabase HS256 JWT locally — no network round-trip.
// Falls back to null if signature is invalid or token is expired.
function verifyJwt(token: string): { sub: string } | null {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return null

  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, payload, signature] = parts
    const hmac = crypto.createHmac('sha256', secret)
    hmac.update(`${header}.${payload}`)
    const expected = hmac.digest('base64url')
    if (expected !== signature) return null

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof decoded.sub !== 'string') return null
    if (typeof decoded.exp === 'number' && decoded.exp * 1000 < Date.now()) return null

    return { sub: decoded.sub }
  } catch {
    return null
  }
}

// Lese-/lettskriv-rute: kun egen DB, normal svartid i hundrevis av ms (målt
// p95 < 1 s mot prod 16. august 2026). 15 s dekker kald start med god margin
// og dreper et hengende Supabase-kall tidlig — i stedet for å arve
// plattformdefaulten på 300 s.
export const maxDuration = 15

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> }
): Promise<NextResponse<AttemptDetail | { error: string }>> {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 })
  }

  // Prefer local JWT verification (fast). Fall back to remote getUser() if
  // SUPABASE_JWT_SECRET is not set in the environment.
  let userId: string | null = null
  const local = verifyJwt(token)
  if (local) {
    userId = local.sub
  } else {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Ugyldig sesjon' }, { status: 401 })
    }
    userId = user.id
  }

  // Samme delte Premium-sjekk som resten av gatingen (lib/premium-check.ts),
  // inkludert karensperiodene. Var tidligere en lokal `premium_status`-spørring
  // som ikke tok karens med, og der `data: null` — som er BÅDE «raden finnes
  // ikke» og resultatet av en transient DB-feil — ga 404 «Profil ikke funnet».
  // Nå: lesefeil → 503 (forbigående, kan prøves på nytt), manglende profilrad
  // → 403 som enhver annen ikke-Premium (bevisst endring fra 404, godkjent
  // 19. august 2026 — profil-eksistens er ikke noe denne ruten skal avsløre).
  const premium = await getUserPremium(userId)
  if (!premium.ok) {
    return NextResponse.json(
      { error: 'Kunne ikke bekrefte tilgangen din akkurat nå. Prøv igjen om litt.' },
      { status: 503 }
    )
  }
  if (!premium.value) {
    return NextResponse.json({ error: 'Krever premium' }, { status: 403 })
  }

  const { attemptId } = await params
  const detail = await getAttemptDetail(attemptId, userId)

  if (!detail) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 })
  }

  return NextResponse.json(detail)
}
