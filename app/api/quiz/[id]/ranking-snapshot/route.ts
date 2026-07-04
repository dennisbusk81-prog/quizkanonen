import { NextRequest, NextResponse } from 'next/server'
import { getOrBuildSnapshot, computePlacement } from '@/lib/ranking-snapshot'

type RankResult = { rank: number; total: number; low: number; high: number }

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
    // Delt, kortlevd snapshot (samme som premium live-ranking leser).
    const snapshot = await getOrBuildSnapshot(quizId, questionIndex)

    // FIX 8 — ingen fullførte ennå: total: 0, ikke 1 (unngår «nr. 1 av 1» når
    // ingen har spilt).
    if (snapshot.length < 1) {
      return NextResponse.json({ rank: 1, total: 0, low: 1, high: 1 })
    }

    // Under spill: spilleren har ikke levert ennå og er ikke i den ferdige
    // poolen → playerInPool: false (total = ferdige + 1). Resultatskjermen bruker
    // /standings, ikke denne ruten. computePlacement garanterer rang <= total.
    const { rank, total, low, high } = computePlacement(snapshot, { correct, time, playerInPool: false })

    return NextResponse.json({ rank, total, low, high })
  } catch (err) {
    console.error('[ranking-snapshot] feil:', err)
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 })
  }
}
