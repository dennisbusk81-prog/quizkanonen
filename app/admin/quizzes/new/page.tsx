'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'

const CATEGORIES = [
  'Sport', 'Musikk', 'Historie', 'Geografi', 'Film & TV',
  'Mat & Drikke', 'Vitenskap & Natur', 'Kunst & Kultur',
  'Politikk & Samfunn', 'Diverse',
]

type Question = {
  id: number
  text: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string
  timeLimit: number
  category: string
  shuffle: boolean
}

function nextFridayNoon(): string {
  const now = new Date()
  const day = now.getDay()
  const daysUntil = day === 5 ? 7 : (5 - day + 7) % 7 || 7
  const d = new Date(now)
  d.setDate(d.getDate() + daysUntil)
  d.setHours(12, 0, 0, 0)
  return toLocalDT(d)
}

function toLocalDT(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function addHours(localDT: string, hours: number): string {
  if (!localDT) return ''
  const d = new Date(localDT)
  d.setHours(d.getHours() + hours)
  return toLocalDT(d)
}

let _counter = 0
function emptyQuestion(): Question {
  return { id: ++_counter, text: '', optionA: '', optionB: '', optionC: '', optionD: '', correctAnswer: 'A', timeLimit: 10, category: '', shuffle: false }
}

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Instrument+Sans:wght@400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:     #1a1c23;
    --card:   #21242e;
    --border: #2a2d38;
    --gold:   #c9a84c;
    --white:  #ffffff;
    --body:   #e8e4dd;
    --muted:  #7a7873;
    --rcard:  16px;
    --rbtn:   10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .nq-page {
    max-width: 680px;
    margin: 0 auto;
    padding: 0 20px 100px;
  }

  .nq-header { padding: 40px 0 28px; }

  .nq-back {
    font-size: 13px;
    color: var(--body);
    text-decoration: none;
    display: inline-block;
    margin-bottom: 14px;
    transition: color 0.15s;
  }
  .nq-back:hover { color: var(--gold); }

  .nq-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
  }

  /* Card */
  .nq-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--rcard);
    padding: 28px;
    margin-bottom: 0;
  }

  /* Labels */
  .nq-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 7px;
  }

  .nq-field { margin-bottom: 18px; }
  .nq-field:last-child { margin-bottom: 0; }

  /* Inputs */
  .nq-input, .nq-select {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    padding: 14px 16px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    color: var(--white);
    outline: none;
    transition: border-color 0.15s;
    -webkit-appearance: none;
  }
  .nq-input::placeholder { color: var(--muted); }
  .nq-input:focus, .nq-select:focus { border-color: var(--gold); }
  .nq-select { cursor: pointer; }

  /* Quiz title input — larger */
  .nq-quiz-title-input {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--border);
    border-radius: 0;
    padding: 8px 0 12px;
    font-family: 'Libre Baskerville', serif;
    font-size: 22px;
    color: var(--white);
    outline: none;
    transition: border-color 0.15s;
    margin-bottom: 24px;
  }
  .nq-quiz-title-input::placeholder { color: var(--muted); font-style: italic; }
  .nq-quiz-title-input:focus { border-bottom-color: var(--gold); }

  /* Datetime row */
  .nq-datetime-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  /* Question number label */
  .nq-q-num {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 14px;
  }

  /* Question textarea */
  .nq-q-textarea {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    padding: 14px 16px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 16px;
    color: var(--white);
    outline: none;
    resize: none;
    transition: border-color 0.15s;
    margin-bottom: 20px;
    line-height: 1.5;
  }
  .nq-q-textarea::placeholder { color: var(--muted); }
  .nq-q-textarea:focus { border-color: var(--gold); }

  /* Answer options grid */
  .nq-options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 20px;
  }

  .nq-option-header {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 7px;
  }

  .nq-option-letter {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--muted);
    text-transform: uppercase;
  }

  .nq-correct-tag {
    font-size: 11px;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.04em;
  }

  /* Meta row: time + category */
  .nq-q-meta {
    display: flex;
    gap: 12px;
    align-items: flex-end;
    margin-bottom: 20px;
  }

  .nq-time-wrap {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .nq-time-input {
    width: 80px;
    padding-right: 36px;
    -moz-appearance: textfield;
  }
  .nq-time-input::-webkit-outer-spin-button,
  .nq-time-input::-webkit-inner-spin-button { -webkit-appearance: none; }

  .nq-time-unit {
    position: absolute;
    right: 12px;
    font-size: 13px;
    color: var(--muted);
    pointer-events: none;
  }

  .nq-cat-wrap { flex: 1; }

  /* Footer: toggle + delete */
  .nq-q-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
  }

  .nq-shuffle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .nq-shuffle-text {
    font-size: 13px;
    color: var(--body);
    user-select: none;
  }

  /* Toggle */
  .nq-toggle {
    width: 40px;
    height: 22px;
    border-radius: 11px;
    background: var(--border);
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    position: relative;
    transition: background 0.18s;
  }
  .nq-toggle.on { background: var(--gold); }
  .nq-toggle-knob {
    width: 16px;
    height: 16px;
    background: var(--white);
    border-radius: 50%;
    position: absolute;
    top: 3px;
    left: 3px;
    transition: transform 0.18s;
  }
  .nq-toggle.on .nq-toggle-knob { transform: translateX(18px); }

  /* Delete */
  .nq-delete-btn {
    font-size: 13px;
    color: var(--body);
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 0;
    text-decoration: underline;
    text-underline-offset: 3px;
    transition: color 0.15s;
    white-space: nowrap;
  }
  .nq-delete-btn:hover { color: #c94c4c; }

  /* Add question button */
  .nq-add-btn {
    display: block;
    width: 100%;
    margin-top: 12px;
    padding: 14px 28px;
    background: var(--gold);
    border: none;
    border-radius: var(--rbtn);
    color: #1a1c23;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
    text-align: center;
  }
  .nq-add-btn:hover { background: #d9b85c; }

  /* Save button */
  .nq-save-btn {
    display: block;
    width: 100%;
    margin-top: 12px;
    padding: 14px 28px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    color: var(--body);
    font-family: 'Instrument Sans', sans-serif;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.15s;
    text-align: center;
  }
  .nq-save-btn:hover { border-color: var(--gold); }
  .nq-save-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  @media (max-width: 540px) {
    .nq-datetime-row { grid-template-columns: 1fr; }
    .nq-options-grid { grid-template-columns: 1fr; }
    .nq-q-meta { flex-direction: column; align-items: stretch; }
    .nq-time-wrap { width: 100%; }
    .nq-time-input { width: 100%; }
  }
`

export default function NewQuiz() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [opensAt, setOpensAt] = useState('')
  const [closesAt, setClosesAt] = useState('')
  const [questions, setQuestions] = useState<Question[]>(() => [emptyQuestion()])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
    const opens = nextFridayNoon()
    setOpensAt(opens)
    setClosesAt(addHours(opens, 24))
  }, [router])

  const handleOpensChange = (val: string) => {
    setOpensAt(val)
    if (val) setClosesAt(addHours(val, 24))
  }

  const updateQ = (id: number, patch: Partial<Question>) =>
    setQuestions(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q))

  const addQuestion = () => setQuestions(qs => [...qs, emptyQuestion()])

  const removeQuestion = (id: number) =>
    setQuestions(qs => qs.length > 1 ? qs.filter(q => q.id !== id) : qs)

  const clampTime = (val: string) => Math.min(60, Math.max(5, parseInt(val) || 10))

  const handleSave = async () => {
    if (!title.trim()) { alert('Legg inn et quiznavn.'); return }
    if (!opensAt || !closesAt) { alert('Fyll inn åpnings- og stengetid.'); return }
    const bad = questions.findIndex(q => !q.text.trim() || !q.optionA.trim() || !q.optionB.trim())
    if (bad !== -1) {
      alert(`Spørsmål ${bad + 1} mangler spørsmålstekst eller svaralternativ A/B.`)
      return
    }
    setSaving(true)
    try {
      const res = await adminFetch('/api/admin/quizzes/import', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          opens_at: new Date(opensAt).toISOString(),
          closes_at: new Date(closesAt).toISOString(),
          questions: questions.map(q => ({
            question_text: q.text.trim(),
            option_a: q.optionA.trim(),
            option_b: q.optionB.trim(),
            option_c: q.optionC.trim() || null,
            option_d: q.optionD.trim() || null,
            correct_answer: q.correctAnswer,
            time_limit_seconds: q.timeLimit,
            shuffle_options: q.shuffle,
            category: q.category || null,
          })),
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        alert('Feil ved lagring: ' + d.error)
        return
      }
      const data = await res.json()
      router.push(`/admin/quizzes/${data.quizId}/questions`)
    } catch {
      alert('Uventet feil ved lagring.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <style>{STYLES}</style>
      <div className="nq-page">

        <header className="nq-header">
          <Link href="/admin/quizzes" className="nq-back">← Tilbake</Link>
          <h1 className="nq-title">Ny quiz</h1>
        </header>

        {/* Grunninfo */}
        <div className="nq-card">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Fredagsquizen 16. mai"
            className="nq-quiz-title-input"
          />
          <div className="nq-datetime-row">
            <div className="nq-field" style={{ marginBottom: 0 }}>
              <label className="nq-label">Åpner</label>
              <input
                type="datetime-local"
                value={opensAt}
                onChange={e => handleOpensChange(e.target.value)}
                className="nq-input"
              />
            </div>
            <div className="nq-field" style={{ marginBottom: 0 }}>
              <label className="nq-label">Stenger</label>
              <input
                type="datetime-local"
                value={closesAt}
                onChange={e => setClosesAt(e.target.value)}
                className="nq-input"
              />
            </div>
          </div>
        </div>

        {/* Questions */}
        {questions.map((q, i) => (
          <div key={q.id} className="nq-card" style={{ marginTop: 12 }}>
            <p className="nq-q-num">Spørsmål {i + 1}</p>

            <textarea
              value={q.text}
              onChange={e => updateQ(q.id, { text: e.target.value })}
              placeholder="Hva er hovedstaden i Frankrike?"
              className="nq-q-textarea"
              rows={2}
            />

            <div className="nq-options-grid">
              {([
                { letter: 'A', field: 'optionA' as const, placeholder: 'Svaralternativ A' },
                { letter: 'B', field: 'optionB' as const, placeholder: 'Svaralternativ B' },
                { letter: 'C', field: 'optionC' as const, placeholder: 'Svaralternativ C (valgfritt)' },
                { letter: 'D', field: 'optionD' as const, placeholder: 'Svaralternativ D (valgfritt)' },
              ]).map(({ letter, field, placeholder }) => {
                const isCorrect = q.correctAnswer === letter
                return (
                  <div key={letter}>
                    <div
                      className="nq-option-header"
                      onClick={() => updateQ(q.id, { correctAnswer: letter })}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        border: `1.5px solid ${isCorrect ? '#4ade80' : '#2a2d38'}`,
                        background: isCorrect ? '#4ade80' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s',
                      }}>
                        {isCorrect && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1a1c23' }} />}
                      </div>
                      <span className="nq-option-letter" style={{ color: isCorrect ? '#4ade80' : undefined }}>
                        {letter}
                      </span>
                      {isCorrect && <span className="nq-correct-tag">Riktig</span>}
                    </div>
                    <input
                      type="text"
                      value={q[field]}
                      onChange={e => updateQ(q.id, { [field]: e.target.value })}
                      placeholder={placeholder}
                      className="nq-input"
                      style={isCorrect ? { borderColor: 'rgba(74,222,128,0.3)' } : undefined}
                    />
                  </div>
                )
              })}
            </div>

            <div className="nq-q-meta">
              <div>
                <label className="nq-label">Tid</label>
                <div className="nq-time-wrap">
                  <input
                    type="number"
                    value={q.timeLimit}
                    min={5}
                    max={60}
                    onChange={e => updateQ(q.id, { timeLimit: clampTime(e.target.value) })}
                    className="nq-input nq-time-input"
                  />
                  <span className="nq-time-unit">sek</span>
                </div>
              </div>
              <div className="nq-cat-wrap">
                <label className="nq-label">Kategori</label>
                <select
                  value={q.category}
                  onChange={e => updateQ(q.id, { category: e.target.value })}
                  className="nq-input nq-select"
                >
                  <option value="">Ikke valgt</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="nq-q-footer">
              <label className="nq-shuffle-row">
                <button
                  type="button"
                  onClick={() => updateQ(q.id, { shuffle: !q.shuffle })}
                  className={`nq-toggle${q.shuffle ? ' on' : ''}`}
                >
                  <div className="nq-toggle-knob" />
                </button>
                <span className="nq-shuffle-text">Bland svaralternativer</span>
              </label>
              {questions.length > 1 && (
                <button type="button" onClick={() => removeQuestion(q.id)} className="nq-delete-btn">
                  Slett spørsmål
                </button>
              )}
            </div>
          </div>
        ))}

        <button type="button" onClick={addQuestion} className="nq-add-btn">
          + Legg til spørsmål
        </button>

        <button type="button" onClick={handleSave} disabled={saving} className="nq-save-btn">
          {saving ? 'Lagrer...' : 'Lagre quiz'}
        </button>

      </div>
    </>
  )
}
