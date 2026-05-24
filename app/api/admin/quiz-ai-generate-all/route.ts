import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT_TEMPLATE = `Du er en quiz-assistent for Quizkanonen, en ukentlig nordisk quiz.
Generer {count} varierte quiz-spørsmål på norsk basert på temaet: {topic}.
Spørsmålene skal passe for et nordisk publikum fra Norge, Sverige og Danmark — unngå spørsmål som krever svært spesifikk norsk lokalkunnskap med mindre temaet eksplisitt er Norge. Varier kategoriene.
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
  // FIX 5 — require admin password
  const adminPassword = process.env.ADMIN_PASSWORD
  if (adminPassword) {
    const provided = req.headers.get('x-admin-password') ?? ''
    if (provided !== adminPassword) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

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

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE
    .replace('{count}', String(count))
    .replace('{topic}', topic.trim())

  // Scale token budget: 10 spørsmål trenger ~6000, 15 spørsmål ~8000
  const maxTokens = count <= 10 ? 6000 : 8000

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
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Generer ${count} spørsmål om: ${topic.trim()}` }],
      }),
    })

    if (!aiRes.ok) {
      // FIX 13 — log Anthropic error details before returning 502
      const errBody = await aiRes.text().catch(() => '(unreadable)')
      console.error('[quiz-ai-generate-all] Anthropic error', aiRes.status, errBody)
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
