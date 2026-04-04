'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'
import { Quiz, Question } from '@/lib/supabase'
import Link from 'next/link'

type AttemptRow = {
  id: string
  correct_answers: number
  total_questions: number
  total_time_ms: number
  completed_at: string
  is_team: boolean
}

type AnswerRow = {
  question_id: string
  is_correct: boolean
  selected_answer: string | null
  time_ms: number
}

type QuestionStat = {
  question: Question
  total_answers: number
  correct_answers: number
  correct_pct: number
  avg_time_ms: number
  option_counts: Record<string, number>
}

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #1a1c23;
    --card:     #21242e;
    --border:   #2a2d38;
    --gold:     #c9a84c;
    --gold-bg:  rgba(201,168,76,0.10);
    --gold-bdr: rgba(201,168,76,0.22);
    --white:    #ffffff;
    --body:     #e8e4dd;
    --muted:    #6a6860;
    --green:    #4ade80;
    --green-bg: rgba(74,222,128,0.10);
    --green-bdr:rgba(74,222,128,0.20);
    --yellow:   #facc15;
    --orange:   #fb923c;
    --red:      #f87171;
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .an-page { max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }

  /* Header */
  .an-header { padding: 48px 0 28px; }

  .an-back {
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    display: inline-block;
    margin-bottom: 12px;
    transition: color 0.15s;
  }
  .an-back:hover { color: var(--gold); }

  .an-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }
  .an-title em { font-style: italic; color: var(--gold); }

  .an-subtitle { font-size: 13px; color: var(--muted); font-style: italic; }

  .an-rule { width: 100%; height: 1px; background: var(--border); margin: 24px 0; }

  /* Section label */
  .an-section {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 32px 0 16px;
  }
  .an-section-text {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }
  .an-section-line { flex: 1; height: 1px; background: var(--border); }

  /* Stats grid */
  .an-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 8px;
  }

  .an-stat {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 18px 16px;
  }

  .an-stat-icon { font-size: 18px; margin-bottom: 10px; }

  .an-stat-value {
    font-family: 'Libre Baskerville', serif;
    font-size: 24px;
    font-weight: 700;
    color: var(--white);
    margin-bottom: 4px;
    line-height: 1;
  }

  .an-stat-label { font-size: 11px; color: var(--muted); }

  /* Score distribution */
  .an-dist {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 22px 24px;
    margin-bottom: 8px;
  }

  .an-dist-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }
  .an-dist-row:last-child { margin-bottom: 0; }

  .an-dist-label { font-size: 12px; color: var(--muted); width: 56px; flex-shrink: 0; }

  .an-dist-track {
    flex: 1;
    height: 8px;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .an-dist-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.4s ease;
  }

  .an-dist-count { font-size: 12px; color: var(--muted); width: 64px; text-align: right; flex-shrink: 0; }

  /* Question stat card */
  .an-q-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 20px;
    margin-bottom: 8px;
  }

  .an-q-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }

  .an-q-num { font-size: 10px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 5px; }

  .an-q-text {
    font-family: 'Libre Baskerville', serif;
    font-size: 14px;
    color: var(--white);
    line-height: 1.45;
    font-weight: 400;
  }

  .an-q-score { text-align: right; flex-shrink: 0; }

  .an-q-pct {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 3px;
  }

  .an-q-difficulty { font-size: 11px; margin-bottom: 5px; }
  .an-q-time { font-size: 11px; color: var(--muted); }

  .an-q-pct.easy   { color: var(--green); }
  .an-q-pct.medium { color: var(--yellow); }
  .an-q-pct.hard   { color: var(--red); }

  .an-q-difficulty.easy   { color: var(--green); }
  .an-q-difficulty.medium { color: var(--yellow); }
  .an-q-difficulty.hard   { color: var(--red); }

  /* Option bars */
  .an-opt-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
  }
  .an-opt-row:last-child { margin-bottom: 0; }

  .an-opt-letter {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
    background: var(--border);
    color: var(--muted);
  }

  .an-opt-letter.correct { background: var(--green); color: #0f0f10; }

  .an-opt-track {
    flex: 1;
    height: 6px;
    background: var(--bg);
    border-radius: 3px;
    overflow: hidden;
  }

  .an-opt-fill { height: 100%; border-radius: 3px; background: var(--border); transition: width 0.3s; }
  .an-opt-fill.correct { background: var(--green); }

  .an-opt-name { font-size: 11px; color: var(--muted); width: 100px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .an-opt-count { font-size: 11px; color: var(--muted); width: 48px; text-align: right; flex-shrink: 0; }

  /* Empty */
  .an-empty {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 56px 24px;
    text-align: center;
  }
  .an-empty-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    color: var(--white);
    margin-bottom: 8px;
  }
  .an-empty-sub { font-size: 13px; color: var(--muted); line-height: 1.6; }

  .an-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .an-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }

  @media (max-width: 520px) {
    .an-stats { grid-template-columns: 1fr 1fr; }
    .an-opt-name { width: 70px; }
  }
`

export default function QuizAnalytics() {
  const params = useParams()
  const router = useRouter()
  const quizId = params.id as string

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [attempts, setAttempts] = useState<AttemptRow[]>([])
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await adminFetch(`/api/admin/quizzes/${quizId}/analytics`)
      if (!res.ok) throw new Error(`API svarte ${res.status}`)
      const data = await res.json()
      setQuiz(data.quiz)
      setQuestions(data.questions)
      setAttempts(data.attempts)
      setAnswers(data.answers)
    } catch (e) {
      console.error('fetchData feilet:', e)
    } finally {
      setLoading(false)
    }
  }

  const totalStarts = attempts.length
  const avgScore = totalStarts > 0
    ? Math.round(attempts.reduce((sum, a) => sum + (a.correct_answers / a.total_questions) * 100, 0) / totalStarts)
    : 0
  const avgTimeSec = totalStarts > 0
    ? Math.round(attempts.reduce((sum, a) => sum + a.total_time_ms, 0) / totalStarts / 1000)
    : 0
  const soloCount = attempts.filter(a => !a.is_team).length
  const teamCount = attempts.filter(a => a.is_team).length

  const questionStats: QuestionStat[] = questions.map(q => {
    const qAnswers = answers.filter(a => a.question_id === q.id)
    const correct = qAnswers.filter(a => a.is_correct).length
    const total = qAnswers.length
    const avgTime = total > 0 ? Math.round(qAnswers.reduce((s, a) => s + a.time_ms, 0) / total / 1000) : 0
    const option_counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 }
    qAnswers.forEach(a => {
      if (a.selected_answer && option_counts[a.selected_answer] !== undefined) {
        option_counts[a.selected_answer]++
      }
    })
    return {
      question: q,
      total_answers: total,
      correct_answers: correct,
      correct_pct: total > 0 ? Math.round((correct / total) * 100) : 0,
      avg_time_ms: avgTime,
      option_counts,
    }
  })

  const formatTime = (sec: number) => sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`

  const diffClass = (pct: number) => pct >= 70 ? 'easy' : pct >= 40 ? 'medium' : 'hard'
  const diffLabel = (pct: number) => pct >= 70 ? 'Lett' : pct >= 40 ? 'Middels' : 'Vanskelig'

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="an-loading"><p>Laster analytics...</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="an-page">

        <header className="an-header">
          <Link href={`/admin/quizzes/${quizId}/questions`} className="an-back">← Tilbake til spørsmål</Link>
          <h1 className="an-title">Ana<em>lytics</em></h1>
          <p className="an-subtitle">{quiz?.title}</p>
        </header>

        <div className="an-rule" />

        {totalStarts === 0 ? (
          <div className="an-empty">
            <p className="an-empty-title">Ingen data ennå</p>
            <p className="an-empty-sub">
              Analytics vises her når spillere har fullført quizen.
            </p>
          </div>
        ) : (
          <>
            {/* Nøkkeltall */}
            <div className="an-section">
              <span className="an-section-text">Nøkkeltall</span>
              <div className="an-section-line" />
            </div>

            <div className="an-stats">
              {[
                { label: 'Gjennomspillinger', value: totalStarts, icon: '🎮' },
                { label: 'Gjennomsnittsscore', value: `${avgScore}%`, icon: '🎯' },
                { label: 'Snitt spilletid', value: formatTime(avgTimeSec), icon: '⏱' },
                { label: 'Enkeltspillere', value: soloCount, icon: '👤' },
                { label: 'Lag', value: teamCount, icon: '👥' },
              ].map(s => (
                <div key={s.label} className="an-stat">
                  <div className="an-stat-icon">{s.icon}</div>
                  <div className="an-stat-value">{s.value}</div>
                  <div className="an-stat-label">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Scorefordeling */}
            <div className="an-section">
              <span className="an-section-text">Scorefordeling</span>
              <div className="an-section-line" />
            </div>

            <div className="an-dist">
              {[
                { label: '80–100%', min: 0.8, max: 1.01, color: 'var(--green)' },
                { label: '60–79%', min: 0.6, max: 0.8,  color: 'var(--yellow)' },
                { label: '40–59%', min: 0.4, max: 0.6,  color: 'var(--orange)' },
                { label: '0–39%',  min: 0,   max: 0.4,  color: 'var(--red)' },
              ].map(bucket => {
                const count = attempts.filter(a => {
                  const pct = a.correct_answers / a.total_questions
                  return pct >= bucket.min && pct < bucket.max
                }).length
                const pct = totalStarts > 0 ? Math.round((count / totalStarts) * 100) : 0
                return (
                  <div key={bucket.label} className="an-dist-row">
                    <span className="an-dist-label">{bucket.label}</span>
                    <div className="an-dist-track">
                      <div className="an-dist-fill" style={{ width: `${pct}%`, background: bucket.color }} />
                    </div>
                    <span className="an-dist-count">{count} ({pct}%)</span>
                  </div>
                )
              })}
            </div>

            {/* Per spørsmål */}
            <div className="an-section">
              <span className="an-section-text">Per spørsmål</span>
              <div className="an-section-line" />
            </div>

            {questionStats.map((qs, idx) => {
              const numOpts = quiz?.num_options || 4
              const opts = ['A', 'B', 'C', 'D'].slice(0, numOpts)
              const maxCount = Math.max(...opts.map(o => qs.option_counts[o] || 0), 1)
              const dc = diffClass(qs.correct_pct)

              return (
                <div key={qs.question.id} className="an-q-card">
                  <div className="an-q-top">
                    <div className="flex-1 min-w-0">
                      <p className="an-q-num">Spørsmål {idx + 1}</p>
                      <p className="an-q-text">{qs.question.question_text}</p>
                    </div>
                    <div className="an-q-score">
                      <p className={`an-q-pct ${dc}`}>{qs.correct_pct}%</p>
                      <p className={`an-q-difficulty ${dc}`}>{diffLabel(qs.correct_pct)}</p>
                      <p className="an-q-time">⏱ {qs.avg_time_ms}s snitt</p>
                    </div>
                  </div>

                  <div>
                    {opts.map(opt => {
                      const optKey = opt === 'A' ? 'option_a' : opt === 'B' ? 'option_b' : opt === 'C' ? 'option_c' : 'option_d'
                      const label = qs.question[optKey as keyof Question] as string
                      if (!label) return null
                      const count = qs.option_counts[opt] || 0
                      const pct = qs.total_answers > 0 ? Math.round((count / qs.total_answers) * 100) : 0
                      const isCorrect = qs.question.correct_answer === opt
                      return (
                        <div key={opt} className="an-opt-row">
                          <span className={`an-opt-letter ${isCorrect ? 'correct' : ''}`}>{opt}</span>
                          <div className="an-opt-track">
                            <div className={`an-opt-fill ${isCorrect ? 'correct' : ''}`}
                              style={{ width: `${(count / maxCount) * 100}%` }} />
                          </div>
                          <span className="an-opt-name">{label}</span>
                          <span className="an-opt-count">{count} ({pct}%)</span>
                        </div>
                      )
                    })}
                    {qs.total_answers === 0 && (
                      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Ingen svar registrert ennå.</p>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </>
  )
}