import { supabaseAdmin } from '@/lib/supabase-admin'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

type QuizRow = {
  id: string
  title: string
  allow_teams: boolean
  requires_access_code: boolean
  time_limit_seconds: number | null
  questions: { count: number }[]
  attempts: { count: number }[]
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    color: #e8e4dd;
    min-height: 100vh;
  }

  .qz-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 20px 80px;
  }

  .qz-back {
    display: inline-block;
    font-size: 12px;
    color: #e8e4dd;
    text-decoration: none;
    letter-spacing: 0.04em;
    margin-bottom: 28px;
    transition: color 0.15s;
  }

  .qz-back:hover { color: #ffffff; }

  .qz-header { margin-bottom: 28px; }

  .qz-eyebrow {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #c9a84c;
    margin-bottom: 8px;
  }

  .qz-title {
    font-family: 'Libre Baskerville', serif;
    font-size: clamp(24px, 5vw, 32px);
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.01em;
  }

  .qz-card {
    background: #21242e;
    border: 1px solid #2a2d38;
    border-radius: 16px;
    padding: 14px 18px;
    margin-bottom: 8px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    transition: border-color 0.18s;
  }

  .qz-card:hover { border-color: rgba(201,168,76,0.3); }

  .qz-card-left { flex: 1; min-width: 0; }

  .qz-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }

  .qz-tag {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 9px;
    border-radius: 20px;
    background: rgba(201,168,76,0.10);
    color: #c9a84c;
    border: 1px solid rgba(201,168,76,0.22);
  }

  .qz-tag-muted {
    background: rgba(106,104,96,0.12);
    color: #6a6860;
    border: 1px solid rgba(106,104,96,0.18);
  }

  .qz-quiz-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 19px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.25;
    margin-bottom: 10px;
    letter-spacing: -0.01em;
  }

  .qz-details { display: flex; flex-wrap: wrap; gap: 12px; }
  .qz-detail { font-size: 12px; color: #7a7873; }

  .qz-card-right {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }

  .qz-btn-outline {
    display: inline-flex;
    align-items: center;
    background: transparent;
    color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 18px;
    border-radius: 10px;
    border: 0.5px solid #4a4d5a;
    text-decoration: none;
    white-space: nowrap;
    transition: border-color 0.15s, color 0.15s;
  }

  .qz-btn-outline:hover { border-color: #e8e4dd; color: #ffffff; }

  .qz-btn-ghost {
    font-size: 12px;
    font-weight: 500;
    color: #e8e4dd;
    text-decoration: none;
    transition: color 0.15s;
    padding: 4px 0;
  }

  .qz-btn-ghost:hover { color: #c9a84c; }

  .qz-empty {
    background: #21242e;
    border: 1px solid #2a2d38;
    border-radius: 16px;
    padding: 48px 32px;
    text-align: center;
    font-size: 14px;
    color: #6a6860;
    line-height: 1.6;
  }

  @media (max-width: 520px) {
    .qz-card { flex-direction: column; gap: 16px; }
    .qz-card-right { flex-direction: row; width: 100%; justify-content: flex-start; }
  }
`

export default async function QuizerPage() {
  const { data: quizzes } = await supabaseAdmin
    .from('quizzes')
    .select('id, title, allow_teams, requires_access_code, time_limit_seconds, questions(count), attempts(count)')
    .eq('is_active', true)
    .or(`closes_at.is.null,closes_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })

  const quizList = (quizzes as QuizRow[] | null) ?? []

  return (
    <>
      <style>{css}</style>
      <div className="qz-page">
        <Link href="/" className="qz-back">← Tilbake til forsiden</Link>

        <header className="qz-header">
          <p className="qz-eyebrow">Quizkanonen</p>
          <h1 className="qz-title">Aktive quizer</h1>
        </header>

        {quizList.length === 0 ? (
          <div className="qz-empty">
            Ingen aktive quizer akkurat nå — kom tilbake på fredag.
          </div>
        ) : (
          <div>
            {quizList.map(quiz => {
              const questionCount = quiz.questions[0]?.count ?? 0
              const participantCount = quiz.attempts[0]?.count ?? 0
              return (
                <div key={quiz.id} className="qz-card">
                  <div className="qz-card-left">
                    <div className="qz-tags">
                      <span className="qz-tag">● Åpen</span>
                      {quiz.allow_teams && <span className="qz-tag qz-tag-muted">Lag</span>}
                      {quiz.requires_access_code && <span className="qz-tag qz-tag-muted">Kode</span>}
                    </div>
                    <h2 className="qz-quiz-title">{quiz.title}</h2>
                    <div className="qz-details">
                      {questionCount > 0 && <span className="qz-detail">{questionCount} spørsmål</span>}
                      {participantCount > 0 && <span className="qz-detail">{participantCount} deltakere</span>}
                      {quiz.time_limit_seconds && <span className="qz-detail">{quiz.time_limit_seconds}s per spørsmål</span>}
                    </div>
                  </div>
                  <div className="qz-card-right">
                    <Link href={`/quiz/${quiz.id}`} className="qz-btn-outline">Spill nå</Link>
                    <Link href={`/leaderboard/${quiz.id}`} className="qz-btn-ghost">Toppliste →</Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
