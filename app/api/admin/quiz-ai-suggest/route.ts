import { NextRequest, NextResponse } from 'next/server'

// No ADMIN_PASSWORD check — this endpoint is only reachable from the admin panel
// which is already protected by password-based session (isAdminLoggedIn).

// Mode: suggest answers for an existing question
const SYSTEM_PROMPT_SUGGEST = `Du er en quiz-assistent for Quizkanonen, en norsk ukentlig quiz.
Brukeren gir deg et spørsmål. Du skal returnere JSON med:
- correctAnswer: det riktige svaret (kort, maks 6 ord)
- wrongAnswers: tre feil men plausible svaralternativer (kort, maks 6 ord hver)
- explanation: én setning som forklarer det riktige svaret (maks 20 ord)
Svar KUN med JSON, ingen annen tekst.`

// Mode: generate a full question from a category/topic
const SYSTEM_PROMPT_GENERATE = `Du er en quiz-assistent for Quizkanonen, en norsk ukentlig quiz.
Brukeren gir deg et kategori eller tema. Generer ETT quiz-spørsmål på norsk.
Returner KUN JSON uten annen tekst:
{
  "question": string (ett konkret spørsmål),
  "correctAnswer": string (maks 6 ord),
  "wrongAnswers": [string, string, string] (maks 6 ord hver),
  "explanation": string (maks 20 ord)
}`

export async function POST(req: NextRequest) {

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 503 })

  let question: string | undefined
  let category: string | undefined
  let generate: boolean
  try {
    const body = await req.json()
    question = body.question
    category = body.category
    generate = !!body.generate

    if (!generate && !question?.trim()) {
      return NextResponse.json({ error: 'Missing question' }, { status: 400 })
    }
    if (generate && !category?.trim()) {
      return NextResponse.json({ error: 'Missing category for generate mode' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const systemPrompt = generate ? SYSTEM_PROMPT_GENERATE : SYSTEM_PROMPT_SUGGEST
  const userContent  = generate
    ? `Kategori/tema: ${category}`
    : category
      ? `Kategori: ${category}\nSpørsmål: ${question}`
      : `Spørsmål: ${question}`

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
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!aiRes.ok) {
      return NextResponse.json({ error: 'AI request failed' }, { status: 502 })
    }

    const aiData = await aiRes.json()
    const rawText: string = aiData?.content?.[0]?.text ?? ''

    // Strip any markdown code fences if model wraps in ```json ... ```
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    let parsed: {
      question?: string
      correctAnswer: string
      wrongAnswers: string[]
      explanation: string
    }
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 502 })
    }

    return NextResponse.json({
      ...(generate ? { question: String(parsed.question ?? '') } : {}),
      correctAnswer: String(parsed.correctAnswer ?? ''),
      wrongAnswers:  Array.isArray(parsed.wrongAnswers) ? parsed.wrongAnswers.map(String) : [],
      explanation:   String(parsed.explanation ?? ''),
    })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
