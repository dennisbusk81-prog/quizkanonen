import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Finn mandag 00:00 UTC for inneværende uke
function getMondayUTC(): string {
  const now = new Date()
  const day = now.getUTCDay() // 0=søn, 1=man, ..., 6=lør
  const daysFromMonday = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setUTCDate(now.getUTCDate() - daysFromMonday)
  monday.setUTCHours(0, 0, 0, 0)
  return monday.toISOString()
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name.trim()
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const quizId = searchParams.get('quizId')

  const empty = NextResponse.json(
    { totalPlayers: 0, sampleNames: [] },
    { headers: { 'Cache-Control': 'public, s-maxage=60' } }
  )

  if (!quizId) return empty

  try {
    const weekStart = getMondayUTC()

    const { data: attempts } = await supabaseAdmin
      .from('attempts')
      .select('user_id, player_name')
      .eq('quiz_id', quizId)
      .gte('created_at', weekStart)

    if (!attempts || attempts.length === 0) return empty

    // Unike innloggede brukere og unike gjester (player_name uten user_id)
    const loggedInIds = [...new Set(
      attempts.filter(a => a.user_id).map(a => a.user_id as string)
    )]
    const guestNames = [...new Set(
      attempts.filter(a => !a.user_id && a.player_name).map(a => a.player_name as string)
    )]
    const totalPlayers = loggedInIds.length + guestNames.length

    // Hent opptil 3 tilfeldige display_name fra profiles
    const sampleNames: string[] = []

    if (loggedInIds.length > 0) {
      const sample = shuffle(loggedInIds).slice(0, 3)
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .in('id', sample)
      for (const p of profiles ?? []) {
        if (p.display_name && sampleNames.length < 3) {
          sampleNames.push(firstName(p.display_name))
        }
      }
    }

    // Fyll opp med gjestenavn hvis færre enn 3
    for (const name of shuffle(guestNames)) {
      if (sampleNames.length >= 3) break
      const fn = firstName(name)
      if (fn && !sampleNames.includes(fn)) sampleNames.push(fn)
    }

    return NextResponse.json(
      { totalPlayers, sampleNames },
      { headers: { 'Cache-Control': 'public, s-maxage=60' } }
    )
  } catch {
    return empty
  }
}
