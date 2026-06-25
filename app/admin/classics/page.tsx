'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'

type ClassicQuestion = {
  id: string
  question_text: string
  option_a: string
  option_b: string
  option_c: string | null
  option_d: string | null
  correct_answer: string
  correct_answers: string[] | null
  explanation: string | null
  category: string | null
  quiz_id: string
  quiz_title: string | null
}

type QuizOption = { id: string; title: string }

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:     #1a1c23;
    --card:   #21242e;
    --border: #2a2d38;
    --gold:   #c9a84c;
    --white:  #ffffff;
    --body:   #e8e4dd;
    --muted:  #7a7873;
    --green:  #4ade80;
    --rcard:  16px;
    --rbtn:   10px;
  }

  body { background: var(--bg); font-family: 'Instrument Sans', sans-serif; color: var(--body); }

  .cl-page { flex: 1; max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }
  .cl-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 32px 0 20px; flex-wrap: wrap; }
  .cl-back { font-size: 12px; color: var(--body); text-decoration: none; display: inline-block; margin-bottom: 6px; }
  .cl-back:hover { color: var(--white); }
  .cl-title { font-family: 'Libre Baskerville', serif; font-size: 26px; font-weight: 700; color: var(--white); }
  .cl-rule { height: 1px; background: var(--border); margin-bottom: 24px; }

  .cl-search {
    width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 12px 16px; font-family: 'Instrument Sans', sans-serif; font-size: 14px; color: var(--white);
    outline: none; margin-bottom: 20px; transition: border-color 0.15s;
  }
  .cl-search::placeholder { color: var(--muted); }
  .cl-search:focus { border-color: rgba(201,168,76,0.4); }

  .cl-card {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--rcard);
    padding: 20px; margin-bottom: 12px;
  }
  .cl-q-text { font-size: 15px; color: var(--white); font-weight: 600; margin-bottom: 12px; line-height: 1.4; }
  .cl-opts { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .cl-opt { font-size: 13px; color: var(--body); }
  .cl-opt.correct { color: var(--green); font-weight: 600; }
  .cl-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  .cl-tag {
    font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    border-radius: 20px; padding: 2px 8px;
  }
  .cl-tag-gold { color: var(--gold); background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.18); }
  .cl-tag-muted { color: var(--muted); background: var(--bg); border: 1px solid var(--border); }
  .cl-explanation { font-size: 12px; color: var(--muted); font-style: italic; margin-bottom: 12px; }
  .cl-footer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .cl-quiz-name { font-size: 12px; color: var(--muted); }

  .cl-copy-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .cl-select {
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 7px 12px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; color: var(--body);
    cursor: pointer; outline: none; min-width: 160px; flex: 1;
  }
  .cl-btn-copy {
    background: transparent; border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 7px 16px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; font-weight: 600;
    color: var(--body); cursor: pointer; transition: border-color 0.15s, color 0.15s; white-space: nowrap;
  }
  .cl-btn-copy:hover { border-color: rgba(201,168,76,0.4); color: var(--white); }
  .cl-btn-copy.done { color: var(--green); border-color: rgba(74,222,128,0.3); }
  .cl-btn-copy:disabled { opacity: 0.5; cursor: not-allowed; }

  .cl-empty { text-align: center; padding: 60px 20px; color: var(--muted); font-size: 15px; }
  .cl-count { font-size: 13px; color: var(--muted); margin-bottom: 16px; }
`

export default function ClassicsPage() {
  const router = useRouter()
  const [questions, setQuestions] = useState<ClassicQuestion[]>([])
  const [quizzes,   setQuizzes]   = useState<QuizOption[]>([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [copying,   setCopying]   = useState<string | null>(null)
  const [copyDone,  setCopyDone]  = useState<string | null>(null)
  const [targetMap, setTargetMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.replace('/admin/login'); return }
    Promise.all([
      adminFetch('/api/admin/classics').then(r => r.json()),
      adminFetch('/api/admin/quizzes').then(r => r.json()),
    ]).then(([cData, qData]) => {
      setQuestions(cData.questions ?? [])
      setQuizzes((Array.isArray(qData) ? qData : []).map((q: { id: string; title: string }) => ({ id: q.id, title: q.title })))
    }).finally(() => setLoading(false))
  }, [router])

  const filtered = questions.filter(q => {
    if (!search) return true
    const s = search.toLowerCase()
    return q.question_text.toLowerCase().includes(s) || (q.category ?? '').toLowerCase().includes(s)
  })

  async function copyToQuiz(questionId: string) {
    const targetQuizId = targetMap[questionId]
    if (!targetQuizId) return
    setCopying(questionId)
    try {
      const res = await adminFetch('/api/admin/classics/copy', {
        method: 'POST',
        body: JSON.stringify({ question_id: questionId, target_quiz_id: targetQuizId }),
      })
      if (res.ok) {
        setCopyDone(questionId)
        setTimeout(() => setCopyDone(null), 2500)
      }
    } finally {
      setCopying(null)
    }
  }

  const optMap: Record<string, string> = { A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d' }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="cl-page">
        <div className="cl-header"><p style={{ color: '#7a7873', fontSize: 14, paddingTop: 40 }}>Laster klassikere…</p></div>
      </div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="cl-page">

        <header className="cl-header">
          <div>
            <Link href="/admin/quizzes" className="cl-back">← Tilbake til quizer</Link>
            <h1 className="cl-title">Klassiker<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>banken</em></h1>
          </div>
        </header>

        <div className="cl-rule" />

        <input
          className="cl-search"
          type="text"
          placeholder="Søk på spørsmål eller kategori…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {filtered.length > 0 && (
          <p className="cl-count">{filtered.length} spørsmål{search ? ' funnet' : ''}</p>
        )}

        {filtered.length === 0 ? (
          <div className="cl-empty">
            {search ? 'Ingen spørsmål matcher søket.' : 'Ingen klassikere ennå. Merk spørsmål som klassikere i quiz-editoren.'}
          </div>
        ) : (
          filtered.map(q => {
            const correctKeys = q.correct_answers && q.correct_answers.length > 0 ? q.correct_answers : [q.correct_answer]
            const opts = ['A', 'B', 'C', 'D'].filter(o => (q as any)[optMap[o]])
            return (
              <div key={q.id} className="cl-card">
                <p className="cl-q-text">{q.question_text}</p>

                <div className="cl-opts">
                  {opts.map(o => (
                    <p key={o} className={`cl-opt ${correctKeys.includes(o) ? 'correct' : ''}`}>
                      <strong>{o}: </strong>{(q as any)[optMap[o]]}{correctKeys.includes(o) ? ' ✓' : ''}
                    </p>
                  ))}
                </div>

                <div className="cl-meta">
                  {q.category && <span className="cl-tag cl-tag-gold">{q.category}</span>}
                  {correctKeys.length > 1 && (
                    <span className="cl-tag cl-tag-muted">{correctKeys.length} riktige svar</span>
                  )}
                </div>

                {q.explanation && <p className="cl-explanation">{q.explanation}</p>}

                <div className="cl-footer">
                  <p className="cl-quiz-name">Fra: {q.quiz_title ?? q.quiz_id}</p>
                  <div className="cl-copy-row" style={{ marginLeft: 'auto' }}>
                    <select
                      className="cl-select"
                      value={targetMap[q.id] ?? ''}
                      onChange={e => setTargetMap(prev => ({ ...prev, [q.id]: e.target.value }))}
                    >
                      <option value="">Velg quiz…</option>
                      {quizzes.map(qz => (
                        <option key={qz.id} value={qz.id}>{qz.title}</option>
                      ))}
                    </select>
                    <button
                      className={`cl-btn-copy ${copyDone === q.id ? 'done' : ''}`}
                      disabled={!targetMap[q.id] || copying === q.id}
                      onClick={() => copyToQuiz(q.id)}
                    >
                      {copyDone === q.id ? 'Lagt til!' : copying === q.id ? 'Kopierer…' : 'Legg til i quiz'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}

      </div>
    </>
  )
}
