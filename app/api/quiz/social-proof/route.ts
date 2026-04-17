import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

function emptyResponse() {
  return NextResponse.json(
    { totalPlayers: 0, sampleNames: [] },
    { headers: { 'Cache-Control': 'public, s-maxage=60' } }
  )
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

  if (!quizId) return emptyResponse()

  try {
    const { data: attempts, error: attemptsError } = await supabaseAdmin
      .from('attempts')
      .select('user_id, player_name')
      .eq('quiz_id', quizId)

    if (attemptsError) {
      console.error('[social-proof] attempts query error:', attemptsError)
      return emptyResponse()
    }

    if (!attempts || attempts.length === 0) return emptyResponse()

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
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('display_name')
        .in('id', sample)

      if (profilesError) {
        console.error('[social-proof] profiles query error:', profilesError)
      } else {
        for (const p of profiles ?? []) {
          if (p.display_name && sampleNames.length < 3) {
            sampleNames.push(firstName(p.display_name))
          }
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
  } catch (err) {
    console.error('[social-proof] unexpected error:', err)
    return emptyResponse()
  }
}
