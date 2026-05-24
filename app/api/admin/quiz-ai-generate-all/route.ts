import { NextRequest, NextResponse } from 'next/server'

// No ADMIN_PASSWORD check — only reachable from the admin panel
// which is already protected by password-based session (isAdminLoggedIn).

const SYSTEM_PROMPT_TEMPLATE = `Du er en quiz-assistent for Quizkanonen, en norsk ukentlig quiz.
Brukeren gir deg et tema. Generer {count} quiz-spørsmål på norsk.
Returner KUN et JSON-array uten annen tekst:
[{
  "question": string,
  "correctAnswer": string (maks 6 ord),
  "wrongAnswers": [string, string, string] (maks 6 ord hver),
  "explanation": string (maks 20 ord)
}]`

type AiQuestion = {
  question: string
  correctAnswer: string
  wrongAnswers: string[]
  explanation: string
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 503 })

  let topic: string
  let count: number
  try {
    const body = await req.json()
    topic = body.topic
    count = Math.min(15, Math.max(1, parseInt(body.count) || 10))
    if (!topic?.trim()) return NextResponse.json({ error: 'Missing topic' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace('{count}', String(count))

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Tema: ${topic.trim()}\nAntall spørsmål: ${count}` }],
      }),
    })

    if (!aiRes.ok) {
      return NextResponse.json({ error: 'AI request failed' }, { status: 502 })
    }

    const aiData = await aiRes.json()
    const rawText: string = aiData?.content?.[0]?.text ?? ''

    // Strip any markdown code fences if model wraps in ```json ... ```
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let parsed: AiQuestion[]
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 502 })
    }

    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: 'AI returned unexpected format' }, { status: 502 })
    }

    const questions = parsed.map(q => ({
      question:      String(q.question      ?? ''),
      correctAnswer: String(q.correctAnswer ?? ''),
      wrongAnswers:  Array.isArray(q.wrongAnswers) ? q.wrongAnswers.map(String) : [],
      explanation:   String(q.explanation   ?? ''),
    }))

    return NextResponse.json({ questions })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
