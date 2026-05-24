'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Sport', 'Musikk', 'Historie', 'Geografi', 'Film & TV',
  'Mat & Drikke', 'Vitenskap & Natur', 'Kunst & Kultur',
  'Politikk & Samfunn', 'Diverse',
]

// ── Types ──────────────────────────────────────────────────────────────────────

type QState = {
  text: string
  optionA: string; optionB: string; optionC: string; optionD: string
  correctAnswer: string
  timeLimit: number
  category: string
  explanation: string
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// ── Helpers ────────────────────────────────────────────────────────────────────

const emptyQ = (): QState => ({
  text: '', optionA: '', optionB: '', optionC: '', optionD: '',
  correctAnswer: 'A', timeLimit: 10, category: '', explanation: '',
})

const isComplete = (q: QState) =>
  q.text.trim().length > 0 && q.optionA.trim().length > 0 && q.optionB.trim().length > 0

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

// ── CSS ────────────────────────────────────────────────────────────────────────

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
    --green:  #4a8c5c;
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

  /* ── Back link ── */
  .nq-back {
    font-size: 13px;
    color: var(--body);
    text-decoration: none;
    display: inline-block;
    padding: 24px 0 16px;
    transition: color 0.15s;
  }
  .nq-back:hover { color: var(--gold); }

  /* ── Sticky header ── */
  .nq-sticky-header {
    position: sticky;
    top: 0;
    z-index: 50;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 14px 0 12px;
    margin-bottom: 0;
  }

  /* Always-visible title row */
  .nq-header-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* Quiz title input */
  .nq-quiz-title-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--border);
    border-radius: 0;
    padding: 4px 0 8px;
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    color: var(--white);
    outline: none;
    transition: border-color 0.15s;
  }
  .nq-quiz-title-input::placeholder { color: var(--muted); font-style: italic; }
  .nq-quiz-title-input:focus { border-bottom-color: var(--gold); }

  /* Gear + label toggle */
  .nq-gear-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    color: var(--muted);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    font-size: 13px;
    font-family: 'Instrument Sans', sans-serif;
    white-space: nowrap;
    transition: color 0.15s;
  }
  .nq-gear-btn:hover { color: #e8e4dd; }
  .nq-gear-btn.active { color: var(--gold); }

  /* Save status + manual save button */
  .nq-header-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    flex-shrink: 0;
  }

  .nq-save-status {
    font-size: 12px;
    white-space: nowrap;
    min-height: 16px;
    text-align: right;
  }

  .nq-manual-save-btn {
    background: transparent;
    border: 1px solid #2a2d38;
    border-radius: 10px;
    padding: 7px 18px;
    font-size: 13px;
    font-weight: 600;
    color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.15s, color 0.15s;
  }
  .nq-manual-save-btn:hover { border-color: var(--gold); color: var(--gold); }

  /* Collapsible metadata panel */
  .nq-meta-panel {
    overflow: hidden;
    transition: max-height 0.2s ease, opacity 0.2s ease;
    max-height: 0;
    opacity: 0;
  }
  .nq-meta-panel.open {
    max-height: 400px;
    opacity: 1;
  }

  /* Date row */
  .nq-datetime-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }

  /* Type + shuffle row */
  .nq-header-bottom-row {
    display: flex;
    align-items: flex-end;
    gap: 20px;
  }
  .nq-header-bottom-row > :first-child { flex: 1; }

  /* ── Navigation bar ── */
  .nq-nav-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 0 14px;
    gap: 12px;
  }

  .nq-q-label {
    font-family: 'Libre Baskerville', serif;
    font-size: 15px;
    font-weight: 700;
    color: var(--white);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .nq-dots-row {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .nq-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: transform 0.1s, background 0.15s;
  }
  .nq-dot:hover { transform: scale(1.4); }

  /* ── Labels ── */
  .nq-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }

  /* ── Inputs / selects ── */
  .nq-input, .nq-select {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    padding: 11px 14px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    color: var(--white);
    outline: none;
    transition: border-color 0.15s;
    -webkit-appearance: none;
  }
  .nq-input::placeholder { color: var(--muted); }
  .nq-input:focus, .nq-select:focus { border-color: var(--gold); }
  .nq-select { cursor: pointer; }

  /* ── Question card ── */
  .nq-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--rcard);
    padding: 24px;
    margin-bottom: 0;
  }

  .nq-q-num {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 14px;
  }

  .nq-q-textarea {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    padding: 12px 14px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 16px;
    color: var(--white);
    outline: none;
    resize: none;
    transition: border-color 0.15s;
    margin-bottom: 18px;
    line-height: 1.5;
  }
  .nq-q-textarea::placeholder { color: var(--muted); }
  .nq-q-textarea:focus { border-color: var(--gold); }

  /* ── Answer options ── */
  .nq-options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 18px;
  }

  .nq-option-header {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 6px;
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

  /* ── Meta row: time + category ── */
  .nq-q-meta {
    display: flex;
    gap: 12px;
    align-items: flex-end;
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

  /* ── AI suggest ── */
  .nq-ai-suggest-btn {
    background: transparent;
    border: 1px solid #2a2d38;
    border-radius: 8px;
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 500;
    color: #e8e4dd;
    font-family: 'Instrument Sans', sans-serif;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    margin-top: 10px;
  }
  .nq-ai-suggest-btn:hover:not(:disabled) { border-color: var(--gold); color: var(--gold); }
  .nq-ai-suggest-btn:disabled { opacity: 0.5; cursor: default; }

  .nq-ai-error {
    font-size: 12px;
    color: #c94c4c;
    margin-top: 6px;
  }

  /* ── Explanation textarea ── */
  .nq-explanation-wrap { margin-top: 18px; }

  .nq-explanation-textarea {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    padding: 11px 14px;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 14px;
    color: var(--white);
    outline: none;
    resize: none;
    transition: border-color 0.15s;
    line-height: 1.5;
    min-height: 42px;
  }
  .nq-explanation-textarea::placeholder { color: var(--muted); }
  .nq-explanation-textarea:focus { border-color: var(--gold); }

  /* ── Toggle ── */
  .nq-toggle {
    width: 38px;
    height: 21px;
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
    width: 15px;
    height: 15px;
    background: var(--white);
    border-radius: 50%;
    position: absolute;
    top: 3px;
    left: 3px;
    transition: transform 0.18s;
    pointer-events: none;
  }
  .nq-toggle.on .nq-toggle-knob { transform: translateX(17px); }

  .nq-shuffle-row {
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
    padding-bottom: 2px;
  }
  .nq-shuffle-text {
    font-size: 13px;
    color: var(--body);
    user-select: none;
    white-space: nowrap;
  }

  /* ── Bottom navigation ── */
  .nq-q-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0 0;
    gap: 12px;
  }

  .nq-nav-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--rbtn);
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 600;
    color: var(--body);
    font-family: 'Instrument Sans', sans-serif;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .nq-nav-btn:hover { border-color: var(--gold); color: var(--gold); }

  .nq-nav-btn--gold {
    background: var(--gold);
    border-color: var(--gold);
    color: #0f0f10;
    font-weight: 700;
  }
  .nq-nav-btn--gold:hover {
    background: #d9b85c;
    border-color: #d9b85c;
    color: #0f0f10;
  }

  .nq-nav-counter {
    font-size: 13px;
    color: var(--muted);
    text-align: center;
    flex: 1;
  }

  /* ── Add question link ── */
  .nq-add-q-link {
    display: block;
    font-size: 13px;
    color: #e8e4dd;
    text-decoration: none;
    text-align: center;
    padding: 14px 0 4px;
    margin-bottom: 32px;
    background: none;
    border: none;
    cursor: pointer;
    font-family: 'Instrument Sans', sans-serif;
    transition: color 0.15s;
  }
  .nq-add-q-link:hover { color: var(--gold); }

  /* ── Responsive ── */
  @media (max-width: 540px) {
    .nq-datetime-row { grid-template-columns: 1fr; }
    .nq-options-grid { grid-template-columns: 1fr; }
    .nq-header-bottom-row { flex-direction: column; align-items: stretch; gap: 12px; }
    .nq-q-meta { flex-direction: column; align-items: stretch; }
    .nq-time-wrap { width: 100%; }
    .nq-time-input { width: 100%; }
    .nq-nav-bar { flex-direction: column; align-items: flex-start; gap: 10px; }
    .nq-dots-row { justify-content: flex-start; }
    .nq-meta-panel.open { max-height: 560px; }
  }
`

// ── Component ──────────────────────────────────────────────────────────────────

export default function NewQuiz() {
  const router = useRouter()

  // Quiz header state
  const [title, setTitle]           = useState('')
  const [opensAt, setOpensAt]       = useState('')
  const [closesAt, setClosesAt]     = useState('')
  const [quizType, setQuizType]     = useState<'weekly' | 'bonus'>('weekly')
  const [shuffleAll, setShuffleAll] = useState(false)

  // Collapsible meta panel — open by default for new quiz (no quizId yet)
  const [metaOpen, setMetaOpen] = useState(true)
  const hasCollapsedRef = useRef(false) // collapse once on first question-textarea focus

  // Questions — start with a single empty question
  const [questions, setQuestions] = useState<QState[]>(() => [emptyQ()])
  const [activeIdx, setActiveIdx] = useState(0)

  // DB state
  const [quizId, setQuizId]               = useState<string | null>(null)
  const [questionDbIds, setQuestionDbIds] = useState<string[]>([])

  // Save status
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // AI suggest
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError]     = useState<string | null>(null)

  // Refs for stable callbacks
  const questionsRef     = useRef(questions)
  const shuffleAllRef    = useRef(shuffleAll)
  const quizIdRef        = useRef<string | null>(null)
  const questionDbIdsRef = useRef<string[]>([])
  const opensAtRef       = useRef(opensAt)
  const closesAtRef      = useRef(closesAt)
  const quizTypeRef      = useRef(quizType)
  const titleRef         = useRef(title)
  const activeIdxRef     = useRef(activeIdx)

  useEffect(() => { questionsRef.current = questions },         [questions])
  useEffect(() => { shuffleAllRef.current = shuffleAll },       [shuffleAll])
  useEffect(() => { opensAtRef.current = opensAt },             [opensAt])
  useEffect(() => { closesAtRef.current = closesAt },           [closesAt])
  useEffect(() => { quizTypeRef.current = quizType },           [quizType])
  useEffect(() => { titleRef.current = title },                 [title])
  useEffect(() => { activeIdxRef.current = activeIdx },         [activeIdx])
  useEffect(() => { quizIdRef.current = quizId },               [quizId])
  useEffect(() => { questionDbIdsRef.current = questionDbIds }, [questionDbIds])

  // Auth + date init
  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
    const opens = nextFridayNoon()
    setOpensAt(opens)
    setClosesAt(addHours(opens, 24))
  }, [router])

  // ── Save helpers ─────────────────────────────────────────────────────────────

  function showSaved() {
    setSaveStatus('saved')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
  }

  // Create quiz + placeholder questions in DB (called on title blur)
  const createQuiz = useCallback(async (): Promise<string | null> => {
    const t = titleRef.current.trim()
    if (!t || quizIdRef.current) return quizIdRef.current
    setSaveStatus('saving')
    try {
      const count = questionsRef.current.length
      const res = await adminFetch('/api/admin/quizzes/import', {
        method: 'POST',
        body: JSON.stringify({
          title: t,
          opens_at:  opensAtRef.current  ? new Date(opensAtRef.current).toISOString()  : undefined,
          closes_at: closesAtRef.current ? new Date(closesAtRef.current).toISOString() : undefined,
          quiz_type: quizTypeRef.current,
          questions: Array.from({ length: count }, () => ({
            question_text: '', option_a: '', option_b: '',
            option_c: null, option_d: null,
            time_limit_seconds: 10,
            shuffle_options: shuffleAllRef.current,
            category: null,
          })),
        }),
      })
      if (!res.ok) { setSaveStatus('error'); return null }
      const data = await res.json()
      setQuizId(data.quizId)
      quizIdRef.current = data.quizId

      // Fetch question IDs for subsequent individual patches
      const qRes = await adminFetch(`/api/admin/quizzes/${data.quizId}/questions`)
      if (qRes.ok) {
        const qData = await qRes.json()
        const ids: string[] = (qData.questions ?? []).map((q: { id: string }) => q.id)
        setQuestionDbIds(ids)
        questionDbIdsRef.current = ids
      }
      showSaved()
      return data.quizId
    } catch {
      setSaveStatus('error')
      return null
    }
  }, [])

  // Refresh question IDs from DB
  const refreshQuestionIds = useCallback(async (qId: string) => {
    const qRes = await adminFetch(`/api/admin/quizzes/${qId}/questions`)
    if (qRes.ok) {
      const qData = await qRes.json()
      const ids: string[] = (qData.questions ?? []).map((q: { id: string }) => q.id)
      setQuestionDbIds(ids)
      questionDbIdsRef.current = ids
    }
  }, [])

  // Save a single question — PATCH if exists in DB, POST if new
  const saveQuestion = useCallback(async (idx: number): Promise<void> => {
    const qId = quizIdRef.current
    if (!qId) return // quiz not created yet — will be batched on createQuiz

    const q = questionsRef.current[idx]
    if (!q) return

    const body = {
      question_text:      q.text.trim(),
      option_a:           q.optionA.trim(),
      option_b:           q.optionB.trim(),
      option_c:           q.optionC.trim() || null,
      option_d:           q.optionD.trim() || null,
      correct_answer:     q.correctAnswer,
      time_limit_seconds: q.timeLimit,
      shuffle_options:    shuffleAllRef.current,
      category:           q.category || null,
      explanation:        q.explanation.trim() || null,
    }

    setSaveStatus('saving')
    try {
      const dbId = questionDbIdsRef.current[idx]
      if (dbId) {
        // Existing question — PATCH
        const res = await adminFetch(`/api/admin/quizzes/${qId}/questions/${dbId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        if (!res.ok) { setSaveStatus('error'); return }
      } else {
        // New question — POST, then refresh IDs
        const res = await adminFetch(`/api/admin/quizzes/${qId}/questions`, {
          method: 'POST',
          body: JSON.stringify({ ...body, order_index: idx + 1 }),
        })
        if (!res.ok) { setSaveStatus('error'); return }
        await refreshQuestionIds(qId)
      }
      showSaved()
    } catch {
      setSaveStatus('error')
    }
  }, [refreshQuestionIds])

  // ── Navigation ────────────────────────────────────────────────────────────────

  const goTo = useCallback((newIdx: number) => {
    if (newIdx < 0 || newIdx >= questionsRef.current.length) return
    saveQuestion(activeIdxRef.current) // fire-and-forget
    setActiveIdx(newIdx)
    activeIdxRef.current = newIdx
  }, [saveQuestion])

  // Add a new empty question and navigate to it
  const addQuestion = useCallback(() => {
    const newIdx = questionsRef.current.length
    const updated = [...questionsRef.current, emptyQ()]
    questionsRef.current = updated         // update ref immediately for stable callbacks
    setQuestions(updated)
    saveQuestion(activeIdxRef.current)     // save current before moving
    setActiveIdx(newIdx)
    activeIdxRef.current = newIdx
  }, [saveQuestion])

  // Keyboard shortcuts: arrow keys when no input is focused
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (isField) return
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(activeIdxRef.current + 1) }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(activeIdxRef.current - 1) }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [goTo])

  // ── AI suggest ───────────────────────────────────────────────────────────────

  const handleAiSuggest = async () => {
    const q = questionsRef.current[activeIdxRef.current]
    if (!q || q.text.trim().length < 10) return
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch('/api/admin/quiz-ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q.text.trim(), category: q.category || undefined }),
      })
      if (!res.ok) {
        setAiError('Kunne ikke generere forslag — prøv igjen')
        return
      }
      const data = await res.json()
      const correctLetter = q.correctAnswer as 'A' | 'B' | 'C' | 'D'
      const fieldMap = { A: 'optionA', B: 'optionB', C: 'optionC', D: 'optionD' } as const
      const correctField = fieldMap[correctLetter]
      const wrongFields = (['optionA', 'optionB', 'optionC', 'optionD'] as const).filter(f => f !== correctField)
      setQuestions(qs => qs.map((item, i) =>
        i === activeIdxRef.current
          ? {
              ...item,
              [correctField]:   data.correctAnswer ?? item[correctField],
              [wrongFields[0]]: data.wrongAnswers?.[0] ?? item[wrongFields[0]],
              [wrongFields[1]]: data.wrongAnswers?.[1] ?? item[wrongFields[1]],
              [wrongFields[2]]: data.wrongAnswers?.[2] ?? item[wrongFields[2]],
              explanation:      data.explanation ?? item.explanation,
            }
          : item
      ))
    } catch {
      setAiError('Kunne ikke generere forslag — prøv igjen')
    } finally {
      setAiLoading(false)
    }
  }

  // ── State updaters ────────────────────────────────────────────────────────────

  const updateQ = (patch: Partial<QState>) =>
    setQuestions(qs => qs.map((q, i) => i === activeIdx ? { ...q, ...patch } : q))

  const clampTime = (val: string) => Math.min(60, Math.max(5, parseInt(val) || 10))

  const handleOpensChange = (val: string) => {
    setOpensAt(val)
    if (val) setClosesAt(addHours(val, 24))
  }

  // Final: save current question, create quiz if needed, navigate to review
  const handleFinish = async () => {
    let qId = quizIdRef.current
    if (!qId) {
      if (!titleRef.current.trim()) { alert('Fyll inn quiztittel.'); return }
      qId = await createQuiz()
      if (!qId) return
    }
    await saveQuestion(activeIdx)
    router.push(`/admin/quizzes/${qId}/questions`)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const q      = questions[activeIdx]
  const total  = questions.length
  const isLast = activeIdx === total - 1

  return (
    <>
      <style>{STYLES}</style>
      <div className="nq-page">

        {/* Back link — scrolls away */}
        <Link href="/admin/quizzes" className="nq-back">← Tilbake</Link>

        {/* ── Sticky header ── */}
        <div className="nq-sticky-header">

          {/* Always-visible title row */}
          <div className="nq-header-title-row">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={createQuiz}
              placeholder="Fredagsquizen 23. mai"
              className="nq-quiz-title-input"
            />

            {/* Gear + label — toggle metadata panel */}
            <button
              type="button"
              className={`nq-gear-btn${metaOpen ? ' active' : ''}`}
              onClick={() => setMetaOpen(v => !v)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Innstillinger
            </button>

            {/* Save status + manual save button */}
            <div className="nq-header-right">
              <div className="nq-save-status">
                {saveStatus === 'saved'  && <span style={{ color: '#4a8c5c' }}>Lagret ✓</span>}
                {saveStatus === 'saving' && <span style={{ color: '#7a7873' }}>Lagrer…</span>}
                {saveStatus === 'error'  && <span style={{ color: '#c94c4c' }}>Lagring feilet</span>}
              </div>
              <button
                type="button"
                onClick={() => saveQuestion(activeIdx)}
                className="nq-manual-save-btn"
              >
                Lagre
              </button>
            </div>
          </div>

          {/* Collapsible metadata panel */}
          <div className={`nq-meta-panel${metaOpen ? ' open' : ''}`}>
            <div style={{ paddingTop: 14, paddingBottom: 4 }}>

              {/* Åpner / Stenger */}
              <div className="nq-datetime-row">
                <div>
                  <label className="nq-label">Åpner</label>
                  <input
                    type="datetime-local"
                    value={opensAt}
                    onChange={e => handleOpensChange(e.target.value)}
                    className="nq-input"
                  />
                </div>
                <div>
                  <label className="nq-label">Stenger</label>
                  <input
                    type="datetime-local"
                    value={closesAt}
                    onChange={e => setClosesAt(e.target.value)}
                    className="nq-input"
                  />
                </div>
              </div>

              {/* Quiz-type + Bland svaralternativer */}
              <div className="nq-header-bottom-row">
                <div>
                  <label className="nq-label">Quiz-type</label>
                  <select
                    value={quizType}
                    onChange={e => setQuizType(e.target.value as 'weekly' | 'bonus')}
                    className="nq-input nq-select"
                  >
                    <option value="weekly">Ukentlig (fredagsquiz)</option>
                    <option value="bonus">Bonusquiz</option>
                  </select>
                </div>
                <label className="nq-shuffle-row">
                  <button
                    type="button"
                    onClick={() => setShuffleAll(v => !v)}
                    className={`nq-toggle${shuffleAll ? ' on' : ''}`}
                  >
                    <div className="nq-toggle-knob" />
                  </button>
                  <span className="nq-shuffle-text">Bland svaralternativer</span>
                </label>
              </div>

            </div>
          </div>

        </div>

        {/* ── Navigation bar ── */}
        <div className="nq-nav-bar">
          <span className="nq-q-label">Spørsmål {activeIdx + 1} av {total}</span>
          <div className="nq-dots-row">
            {questions.map((qItem, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                className="nq-dot"
                title={`Spørsmål ${i + 1}`}
                style={{
                  background:
                    i === activeIdx
                      ? '#c9a84c'
                      : isComplete(qItem)
                        ? '#4a8c5c'
                        : '#2a2d38',
                }}
              />
            ))}
          </div>
        </div>

        {/* ── Question card ── */}
        <div className="nq-card">
          <p className="nq-q-num">Spørsmål {activeIdx + 1}</p>

          <textarea
            value={q.text}
            onChange={e => { updateQ({ text: e.target.value }); setAiError(null) }}
            onFocus={() => {
              if (!hasCollapsedRef.current) {
                hasCollapsedRef.current = true
                setMetaOpen(false)
              }
            }}
            placeholder="Hva er hovedstaden i Frankrike?"
            className="nq-q-textarea"
            rows={3}
          />

          {/* AI suggest */}
          {q.text.trim().length >= 10 && (
            <div style={{ marginBottom: 18 }}>
              <button
                type="button"
                onClick={handleAiSuggest}
                disabled={aiLoading}
                className="nq-ai-suggest-btn"
              >
                {aiLoading ? 'Genererer...' : 'Foreslå svar'}
              </button>
              {aiError && <p className="nq-ai-error">{aiError}</p>}
            </div>
          )}

          {/* Answer options — 2x2 grid */}
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
                    onClick={() => updateQ({ correctAnswer: letter })}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <div style={{
                      width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
                      border: `1.5px solid ${isCorrect ? '#4ade80' : '#2a2d38'}`,
                      background: isCorrect ? '#4ade80' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {isCorrect && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1a1c23' }} />}
                    </div>
                    <span className="nq-option-letter" style={isCorrect ? { color: '#4ade80' } : undefined}>
                      {letter}
                    </span>
                    {isCorrect && <span className="nq-correct-tag">Riktig</span>}
                  </div>
                  <input
                    type="text"
                    value={q[field]}
                    onChange={e => updateQ({ [field]: e.target.value })}
                    placeholder={placeholder}
                    className="nq-input"
                    style={isCorrect ? { borderColor: 'rgba(74,222,128,0.3)' } : undefined}
                  />
                </div>
              )
            })}
          </div>

          {/* Time + Category */}
          <div className="nq-q-meta">
            <div>
              <label className="nq-label">Tid</label>
              <div className="nq-time-wrap">
                <input
                  type="number"
                  value={q.timeLimit}
                  min={5}
                  max={60}
                  onChange={e => updateQ({ timeLimit: clampTime(e.target.value) })}
                  className="nq-input nq-time-input"
                />
                <span className="nq-time-unit">sek</span>
              </div>
            </div>
            <div className="nq-cat-wrap">
              <label className="nq-label">Kategori</label>
              <select
                value={q.category}
                onChange={e => updateQ({ category: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goTo(activeIdx + 1) } }}
                className="nq-input nq-select"
              >
                <option value="">Ikke valgt</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Explanation */}
          <div className="nq-explanation-wrap">
            <label className="nq-label">Forklaring</label>
            <textarea
              value={q.explanation}
              onChange={e => updateQ({ explanation: e.target.value })}
              placeholder="Valgfritt — vises etter at spilleren har svart"
              className="nq-explanation-textarea"
              rows={1}
            />
          </div>
        </div>

        {/* ── Navigation buttons ── */}
        <div className="nq-q-nav">
          {activeIdx > 0 ? (
            <button type="button" onClick={() => goTo(activeIdx - 1)} className="nq-nav-btn">
              ← Forrige
            </button>
          ) : (
            <div />
          )}

          <span className="nq-nav-counter">{activeIdx + 1} / {total}</span>

          {isLast ? (
            <button type="button" onClick={handleFinish} className="nq-nav-btn nq-nav-btn--gold">
              Lagre og publiser →
            </button>
          ) : (
            <button type="button" onClick={() => goTo(activeIdx + 1)} className="nq-nav-btn">
              Neste →
            </button>
          )}
        </div>

        {/* ── Add question link ── */}
        <button type="button" onClick={addQuestion} className="nq-add-q-link">
          + Legg til spørsmål
        </button>

      </div>
    </>
  )
}
