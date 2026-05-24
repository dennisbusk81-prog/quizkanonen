import { NextRequest, NextResponse } from 'next/server'

function auth(req: NextRequest) {
  const pw = req.headers.get('x-admin-password')
  return !!pw && pw === process.env.ADMIN_PASSWORD
}

const SYSTEM_PROMPT = `Du er en quiz-assistent for Quizkanonen, en norsk ukentlig quiz.
Brukeren gir deg et spørsmål. Du skal returnere JSON med:
- correctAnswer: det riktige svaret (kort, maks 6 ord)
- wrongAnswers: tre feil men plausible svaralternativer (kort, maks 6 ord hver)
- explanation: én setning som forklarer det riktige svaret (maks 20 ord)
Svar KUN med JSON, ingen annen tekst.`

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 503 })

  let question: string
  let category: string | undefined
  try {
    const body = await req.json()
    question = body.question
    category = body.category
    if (!question?.trim()) return NextResponse.json({ error: 'Missing question' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const userContent = category
    ? `Kategori: ${category}\nSpørsmål: ${question}`
    : `Spørsmål: ${question}`

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!aiRes.ok) {
      const errText = await aiRes.text()
      console.error('[quiz-ai-suggest] Anthropic error:', errText)
      return NextResponse.json({ error: 'AI request failed' }, { status: 502 })
    }

    const aiData = await aiRes.json()
    const rawText: string = aiData?.content?.[0]?.text ?? ''

    // Strip any markdown code fences if model wraps in ```json ... ```
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let parsed: { correctAnswer: string; wrongAnswers: string[]; explanation: string }
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      console.error('[quiz-ai-suggest] Failed to parse JSON:', rawText)
      return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 502 })
    }

    return NextResponse.json({
      correctAnswer: String(parsed.correctAnswer ?? ''),
      wrongAnswers:  Array.isArray(parsed.wrongAnswers) ? parsed.wrongAnswers.map(String) : [],
      explanation:   String(parsed.explanation ?? ''),
    })
  } catch (err) {
    console.error('[quiz-ai-suggest] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
