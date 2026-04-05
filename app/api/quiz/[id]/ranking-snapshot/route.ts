import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rankAttempts } from '@/lib/ranking'
import type { Attempt } from '@/lib/supabase'

type SnapshotEntry = {
  player_name: string
  rank: number
  correct_answers: number
  total_time_ms: number
  correct_streak: number
}

type RankResult = { rank: number; total: number; low: number; high: number }

const CACHE_TTL_MS = 60_000

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<RankResult | { error: string }>> {
  const { id: quizId } = await params
  const { searchParams } = new URL(request.url)

  const questionIndex = parseInt(searchParams.get('question') ?? '0', 10)
  const correct       = parseInt(searchParams.get('correct')  ?? '0', 10)
  const time          = parseInt(searchParams.get('time')     ?? '0', 10)

  if (!quizId || isNaN(questionIndex) || isNaN(correct) || isNaN(time)) {
    return NextResponse.json({ error: 'Ugyldig input' }, { status: 400 })
  }

  try {
    // 1. Sjekk cache
    const { data: cached } = await supabaseAdmin
      .from('ranking_snapshots')
      .select('snapshot, created_at')
      .eq('quiz_id', quizId)
      .eq('question_index', questionIndex)
      .maybeSingle()

    const isStale =
      !cached ||
      Date.now() - new Date(cached.created_at as string).getTime() > CACHE_TTL_MS

    let snapshot: SnapshotEntry[]

    if (!isStale && cached) {
      snapshot = cached.snapshot as SnapshotEntry[]
    } else {
      // 2. Hent alle fullførte forsøk (total_time_ms > 0 = quiz avsluttet)
      const { data: attempts, error: attErr } = await supabaseAdmin
        .from('attempts')
        .select(
          'id, quiz_id, player_name, is_team, team_size, correct_answers, ' +
          'total_questions, total_time_ms, correct_streak, user_id, completed_at'
        )
        .eq('quiz_id', quizId)
        .gt('total_time_ms', 0)

      if (attErr) throw attErr

      // 3. Ranger med eksakt samme logikk som lib/ranking.ts
      const ranked = rankAttempts((attempts ?? []) as unknown as Attempt[])

      snapshot = ranked.map(a => ({
        player_name:     a.player_name,
        rank:            a.rank,
        correct_answers: a.correct_answers,
        total_time_ms:   a.total_time_ms,
        correct_streak:  a.correct_streak ?? 0,
      }))

      // 4. Lagre snapshot (oppdater hvis finnes, insert ellers)
      await supabaseAdmin
        .from('ranking_snapshots')
        .upsert(
          {
            quiz_id:        quizId,
            question_index: questionIndex,
            snapshot,
            created_at:     new Date().toISOString(),
          },
          { onConflict: 'quiz_id,question_index' }
        )
    }

    // 5. Beregn brukerens rangering mot snapshot
    const total = snapshot.length
    if (total < 1) {
      // Ingen fullførte ennå — brukeren er nr. 1
      return NextResponse.json({ rank: 1, total: 1, low: 1, high: 1 })
    }

    const better = snapshot.filter(e =>
      e.correct_answers > correct ||
      (e.correct_answers === correct && e.total_time_ms < time)
    ).length

    const rank = better + 1
    // Spenn på 5: rank-2 → rank+2, clampet til [1, total+1]
    const low  = Math.max(1, rank - 2)
    const high = Math.min(total + 1, rank + 2)

    return NextResponse.json({ rank, total: total + 1, low, high })
  } catch (err) {
    console.error('[ranking-snapshot] feil:', err)
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 })
  }
}
