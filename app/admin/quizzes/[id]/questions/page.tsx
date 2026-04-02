'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { supabase, Quiz, Question } from '@/lib/supabase'
import Link from 'next/link'

type QuestionForm = {
  question_text: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_answer: string
  explanation: string
  time_limit_seconds: string
}

const emptyForm = (): QuestionForm => ({
  question_text: '', option_a: '', option_b: '', option_c: '', option_d: '',
  correct_answer: 'A', explanation: '', time_limit_seconds: ''
})

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
    --body:     #9a9590;
    --muted:    #6a6860;
    --green:    #4ade80;
    --green-bg: rgba(74,222,128,0.10);
    --green-bdr:rgba(74,222,128,0.20);
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .qq-page { max-width: 760px; margin: 0 auto; padding: 0 20px 80px; }

  /* Header */
  .qq-header {
    padding: 48px 0 28px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .qq-back {
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    display: block;
    margin-bottom: 8px;
    transition: color 0.15s;
  }
  .qq-back:hover { color: var(--gold); }

  .qq-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 22px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }

  .qq-title em { font-style: italic; color: var(--gold); }

  .qq-subtitle { font-size: 12px; color: var(--muted); }

  .qq-header-actions { display: flex; gap: 8px; align-items: center; padding-top: 28px; }

  .qq-btn-preview {
    font-size: 12px;
    font-weight: 500;
    color: var(--body);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-btn);
    padding: 8px 14px;
    text-decoration: none;
    transition: border-color 0.15s, color 0.15s;
  }
  .qq-btn-preview:hover { border-color: var(--gold-bdr); color: var(--gold); }

  .qq-btn-add {
    font-size: 13px;
    font-weight: 600;
    color: #0f0f10;
    background: var(--gold);
    border: none;
    border-radius: var(--radius-btn);
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .qq-btn-add:hover { background: #d9b85c; }

  .qq-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 20px; }

  /* Feedback */
  .qq-feedback {
    border-radius: var(--radius-btn);
    padding: 11px 16px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
  }
  .qq-feedback.success { background: var(--green-bg); color: var(--green); border: 1px solid var(--green-bdr); }
  .qq-feedback.error   { background: rgba(248,113,113,0.08); color: #f87171; border: 1px solid rgba(248,113,113,0.18); }

  /* Form card */
  .qq-form-card {
    background: var(--card);
    border: 1px solid var(--gold-bdr);
    border-radius: var(--radius-card);
    padding: 24px;
    margin-bottom: 12px;
  }

  .qq-form-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--white);
    margin-bottom: 20px;
  }

  .qq-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    display: block;
    margin-bottom: 7px;
  }

  .qq-input, .qq-textarea {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-btn);
    padding: 10px 13px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    color: var(--white);
    outline: none;
    transition: border-color 0.15s;
  }
  .qq-input::placeholder, .qq-textarea::placeholder { color: var(--muted); }
  .qq-input:focus, .qq-textarea:focus { border-color: var(--gold); }
  .qq-textarea { resize: none; }

  .qq-field { margin-bottom: 14px; }
  .qq-field:last-child { margin-bottom: 0; }
  .qq-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

  /* Option label with correct indicator */
  .qq-opt-label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 7px;
  }

  .qq-opt-dot {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    background: var(--border);
    color: var(--muted);
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .qq-opt-dot.correct { background: var(--green); color: #0f0f10; }

  .qq-correct-text { font-size: 10px; color: var(--green); font-weight: 600; }

  /* Correct answer selector */
  .qq-answer-btns { display: flex; gap: 6px; }

  .qq-answer-btn {
    flex: 1;
    padding: 8px 4px;
    border-radius: var(--radius-btn);
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--muted);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .qq-answer-btn.active {
    background: var(--green-bg);
    border-color: var(--green-bdr);
    color: var(--green);
  }

  /* Form actions */
  .qq-form-actions { display: flex; gap: 8px; margin-top: 16px; }

  .qq-btn-save {
    flex: 1;
    background: var(--gold);
    color: #0f0f10;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 10px;
    border-radius: var(--radius-btn);
    border: none;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }
  .qq-btn-save:hover { background: #d9b85c; }
  .qq-btn-save:disabled { opacity: 0.35; cursor: not-allowed; }

  .qq-btn-cancel {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--muted);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    padding: 10px 16px;
    border-radius: var(--radius-btn);
    cursor: pointer;
    transition: color 0.15s;
  }
  .qq-btn-cancel:hover { color: var(--white); }

  /* Question row */
  .qq-question {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 16px 18px;
    margin-bottom: 8px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  /* Sort controls */
  .qq-sort {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    padding-top: 2px;
  }

  .qq-sort-btn {
    background: none;
    border: none;
    color: var(--border);
    font-size: 10px;
    cursor: pointer;
    padding: 2px;
    line-height: 1;
    transition: color 0.15s;
  }
  .qq-sort-btn:hover:not(:disabled) { color: var(--gold); }
  .qq-sort-btn:disabled { opacity: 0.2; cursor: default; }

  .qq-sort-num {
    font-size: 11px;
    color: var(--muted);
    line-height: 1;
    padding: 1px 0;
  }

  /* Question content */
  .qq-q-body { flex: 1; min-width: 0; }

  .qq-q-text {
    font-size: 14px;
    font-weight: 500;
    color: var(--white);
    line-height: 1.45;
    margin-bottom: 10px;
  }

  .qq-q-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }

  .qq-q-opt {
    font-size: 11px;
    padding: 5px 9px;
    border-radius: 7px;
    background: var(--bg);
    color: var(--muted);
  }

  .qq-q-opt.correct { background: var(--green-bg); color: var(--green); }

  .qq-q-opt strong { font-weight: 600; margin-right: 4px; }

  .qq-q-explanation {
    font-size: 11px;
    color: var(--muted);
    margin-top: 8px;
  }

  /* Question actions */
  .qq-q-actions { display: flex; flex-direction: column; gap: 5px; flex-shrink: 0; }

  .qq-q-btn {
    font-size: 11px;
    font-weight: 500;
    padding: 5px 10px;
    border-radius: 7px;
    border: none;
    cursor: pointer;
    font-family: 'Instrument Sans', sans-serif;
    transition: opacity 0.15s;
    white-space: nowrap;
  }
  .qq-q-btn:hover { opacity: 0.75; }
  .qq-q-btn.edit { background: rgba(96,165,250,0.12); color: #60a5fa; }
  .qq-q-btn.del  { background: rgba(248,113,113,0.10); color: #f87171; }

  /* Empty */
  .qq-empty {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 48px 24px;
    text-align: center;
  }

  .qq-empty p { font-size: 14px; color: var(--muted); margin-bottom: 16px; }

  /* Footer actions */
  .qq-footer {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 24px;
  }

  .qq-btn-analytics {
    font-size: 13px;
    font-weight: 500;
    color: var(--body);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-btn);
    padding: 10px 18px;
    text-decoration: none;
    transition: border-color 0.15s, color 0.15s;
  }
  .qq-btn-analytics:hover { border-color: var(--gold-bdr); color: var(--gold); }

  .qq-btn-done {
    font-size: 13px;
    font-weight: 600;
    color: #0f0f10;
    background: var(--green);
    border-radius: var(--radius-btn);
    padding: 10px 20px;
    text-decoration: none;
    transition: opacity 0.15s;
  }
  .qq-btn-done:hover { opacity: 0.85; }

  .qq-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .qq-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }

  @media (max-width: 480px) {
    .qq-grid-2 { grid-template-columns: 1fr; }
    .qq-q-opts { grid-template-columns: 1fr; }
    .qq-q-actions { flex-direction: row; }
  }
`

export default function QuizQuestions() {
  const params = useParams()
  const router = useRouter()
  const quizId = params.id as string

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [newQ, setNewQ] = useState<QuestionForm>(emptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<QuestionForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const [{ data: quizData }, { data: questionData }] = await Promise.all([
        supabase.from('quizzes').select('*').eq('id', quizId).single(),
        supabase.from('questions').select('*').eq('quiz_id', quizId).order('order_index'),
      ])
      setQuiz(quizData)
      setQuestions(questionData || [])
    } finally {
      setLoading(false)
    }
  }

  function showFeedback(type: 'success' | 'error', msg: string) {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3000)
  }

  const optionKeys: Record<string, keyof Question> = {
    A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d'
  }
  const numOptions = quiz?.num_options || 4
  const options = ['A', 'B', 'C', 'D'].slice(0, numOptions)

  async function saveQuestion() {
    if (!newQ.question_text || !newQ.option_a || !newQ.option_b) {
      showFeedback('error', 'Fyll inn spørsmål og minst to svaralternativer.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('questions').insert({
      quiz_id: quizId,
      question_text: newQ.question_text,
      option_a: newQ.option_a,
      option_b: newQ.option_b,
      option_c: newQ.option_c || null,
      option_d: newQ.option_d || null,
      correct_answer: newQ.correct_answer,
      explanation: newQ.explanation || null,
      time_limit_seconds: newQ.time_limit_seconds ? parseInt(newQ.time_limit_seconds) : null,
      order_index: questions.length + 1,
    })
    if (error) { showFeedback('error', 'Feil ved lagring: ' + error.message) }
    else {
      showFeedback('success', 'Spørsmål lagret!')
      setNewQ(emptyForm())
      setShowForm(false)
      fetchData()
    }
    setSaving(false)
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    const { error } = await supabase.from('questions').update({
      question_text: editForm.question_text,
      option_a: editForm.option_a,
      option_b: editForm.option_b,
      option_c: editForm.option_c || null,
      option_d: editForm.option_d || null,
      correct_answer: editForm.correct_answer,
      explanation: editForm.explanation || null,
      time_limit_seconds: editForm.time_limit_seconds ? parseInt(editForm.time_limit_seconds) : null,
    }).eq('id', editingId)
    if (error) { showFeedback('error', 'Feil ved oppdatering: ' + error.message) }
    else {
      showFeedback('success', 'Spørsmål oppdatert!')
      setEditingId(null)
      fetchData()
    }
    setSaving(false)
  }

  async function deleteQuestion(id: string) {
    if (!confirm('Slett dette spørsmålet?')) return
    const { error } = await supabase.from('questions').delete().eq('id', id)
    if (error) { showFeedback('error', 'Kunne ikke slette: ' + error.message) }
    else { showFeedback('success', 'Spørsmål slettet.'); fetchData() }
  }

  function startEdit(q: Question) {
    setEditingId(q.id)
    setEditForm({
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c || '',
      option_d: q.option_d || '',
      correct_answer: q.correct_answer,
      explanation: q.explanation || '',
      time_limit_seconds: q.time_limit_seconds?.toString() || '',
    })
  }

  async function moveQuestion(id: string, direction: 'up' | 'down') {
    const idx = questions.findIndex(q => q.id === id)
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === questions.length - 1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    await Promise.all([
      supabase.from('questions').update({ order_index: questions[swapIdx].order_index }).eq('id', questions[idx].id),
      supabase.from('questions').update({ order_index: questions[idx].order_index }).eq('id', questions[swapIdx].id),
    ])
    fetchData()
  }

  function renderForm(
    form: QuestionForm,
    setForm: (f: QuestionForm) => void,
    onSave: () => void,
    onCancel: () => void,
    label: string
  ) {
    const upd = (key: string, val: string) => setForm({ ...form, [key]: val })
    return (
      <div className="qq-form-card">
        <p className="qq-form-title">{label}</p>

        <div className="qq-field">
          <label className="qq-label">Spørsmål *</label>
          <textarea value={form.question_text} onChange={e => upd('question_text', e.target.value)}
            placeholder="Skriv spørsmålet her..." rows={2} className="qq-textarea" />
        </div>

        <div className="qq-field qq-grid-2">
          {options.map(opt => {
            const key = opt === 'A' ? 'option_a' : opt === 'B' ? 'option_b' : opt === 'C' ? 'option_c' : 'option_d'
            const isCorrect = form.correct_answer === opt
            return (
              <div key={opt}>
                <div className="qq-opt-label">
                  <span className={`qq-opt-dot ${isCorrect ? 'correct' : ''}`}>{opt}</span>
                  <label className="qq-label" style={{ margin: 0 }}>
                    Alternativ {opt}
                  </label>
                  {isCorrect && <span className="qq-correct-text">✓ riktig</span>}
                </div>
                <input type="text" value={(form as any)[key]} onChange={e => upd(key, e.target.value)}
                  placeholder={`Alternativ ${opt}`} className="qq-input" />
              </div>
            )
          })}
        </div>

        <div className="qq-field">
          <label className="qq-label">Riktig svar</label>
          <div className="qq-answer-btns">
            {options.map(opt => (
              <button key={opt} onClick={() => upd('correct_answer', opt)}
                className={`qq-answer-btn ${form.correct_answer === opt ? 'active' : ''}`}>
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="qq-field qq-grid-2">
          <div>
            <label className="qq-label">Forklaring (valgfritt)</label>
            <input type="text" value={form.explanation} onChange={e => upd('explanation', e.target.value)}
              placeholder="Kort forklaring..." className="qq-input" />
          </div>
          <div>
            <label className="qq-label">Egendefinert tid (sek)</label>
            <input type="number" value={form.time_limit_seconds} onChange={e => upd('time_limit_seconds', e.target.value)}
              placeholder={`Standard: ${quiz?.time_limit_seconds}s`} className="qq-input" />
          </div>
        </div>

        <div className="qq-form-actions">
          <button onClick={onSave} disabled={saving} className="qq-btn-save">
            {saving ? 'Lagrer...' : 'Lagre'}
          </button>
          <button onClick={onCancel} className="qq-btn-cancel">Avbryt</button>
        </div>
      </div>
    )
  }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="qq-loading"><p>Laster...</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="qq-page">

        <header className="qq-header">
          <div>
            <Link href="/admin/quizzes" className="qq-back">← Tilbake</Link>
            <h1 className="qq-title"><em>{quiz?.title}</em></h1>
            <p className="qq-subtitle">{questions.length} spørsmål · {numOptions} alternativer</p>
          </div>
          <div className="qq-header-actions">
            <Link href={`/quiz/${quizId}`} target="_blank" className="qq-btn-preview">Forhåndsvis ↗</Link>
            <button onClick={() => { setShowForm(!showForm); setEditingId(null) }} className="qq-btn-add">
              {showForm ? '✕ Avbryt' : '+ Nytt spørsmål'}
            </button>
          </div>
        </header>

        <div className="qq-rule" />

        {feedback && (
          <div className={`qq-feedback ${feedback.type}`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
          </div>
        )}

        {showForm && renderForm(newQ, setNewQ, saveQuestion, () => setShowForm(false), 'Nytt spørsmål')}

        {questions.length === 0 && !showForm ? (
          <div className="qq-empty">
            <p>Ingen spørsmål ennå.</p>
            <button onClick={() => setShowForm(true)} className="qq-btn-add">
              + Nytt spørsmål
            </button>
          </div>
        ) : (
          <div>
            {questions.map((q, idx) => (
              <div key={q.id}>
                {editingId === q.id ? (
                  renderForm(editForm, setEditForm, saveEdit, () => setEditingId(null), `Rediger spørsmål ${idx + 1}`)
                ) : (
                  <div className="qq-question">
                    <div className="qq-sort">
                      <button onClick={() => moveQuestion(q.id, 'up')} disabled={idx === 0} className="qq-sort-btn">▲</button>
                      <span className="qq-sort-num">{idx + 1}</span>
                      <button onClick={() => moveQuestion(q.id, 'down')} disabled={idx === questions.length - 1} className="qq-sort-btn">▼</button>
                    </div>

                    <div className="qq-q-body">
                      <p className="qq-q-text">{q.question_text}</p>
                      <div className="qq-q-opts">
                        {options.map(opt => {
                          const val = q[optionKeys[opt]] as string
                          if (!val) return null
                          const isCorrect = q.correct_answer === opt
                          return (
                            <p key={opt} className={`qq-q-opt ${isCorrect ? 'correct' : ''}`}>
                              <strong>{opt}</strong>{val}{isCorrect && ' ✓'}
                            </p>
                          )
                        })}
                      </div>
                      {q.explanation && <p className="qq-q-explanation">💡 {q.explanation}</p>}
                    </div>

                    <div className="qq-q-actions">
                      <button onClick={() => startEdit(q)} className="qq-q-btn edit">Rediger</button>
                      <button onClick={() => deleteQuestion(q.id)} className="qq-q-btn del">Slett</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {questions.length > 0 && (
          <div className="qq-footer">
            <Link href={`/admin/quizzes/${quizId}/analytics`} className="qq-btn-analytics">
              Analytics →
            </Link>
            <Link href="/admin/quizzes" className="qq-btn-done">
              ✓ Ferdig
            </Link>
          </div>
        )}

      </div>
    </>
  )
}