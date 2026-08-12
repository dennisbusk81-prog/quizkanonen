'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { isAdminLoggedIn, adminLoginPath } from '@/lib/admin-session'
import { adminFetch } from '@/lib/admin-fetch'

type BankQuestion = {
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
  is_classic: boolean | null
  usage_count: number | null
  last_used_at: string | null
  created_at: string | null
  hit_rate: number | null
  answer_count: number | null
}

type QuizOption = { id: string; title: string }
type SortKey = 'last_used' | 'most_used' | 'least_used' | 'newest' | 'alphabetical' | 'hit_rate_asc'

const PAGE_SIZE = 40

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
    --muted:  #918f8a;
    --green:  #4ade80;
    --rcard:  16px;
    --rbtn:   10px;
  }

  body { background: var(--bg); font-family: 'Instrument Sans', sans-serif; color: var(--body); }

  .sb-page { flex: 1; max-width: 800px; margin: 0 auto; padding: 0 20px 80px; }
  .sb-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 32px 0 20px; flex-wrap: wrap; }
  .sb-back { font-size: 12px; color: var(--body); text-decoration: none; display: inline-block; margin-bottom: 6px; }
  .sb-back:hover { color: var(--gold); }
  .sb-title { font-family: 'Libre Baskerville', serif; font-size: 26px; font-weight: 700; color: var(--white); }
  .sb-rule { height: 1px; background: var(--border); margin-bottom: 24px; }

  .sb-controls { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; align-items: center; }

  .sb-search {
    flex: 1; min-width: 200px; background: var(--card); border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 12px 16px; font-family: 'Instrument Sans', sans-serif; font-size: 14px; color: var(--white);
    outline: none; transition: border-color 0.15s;
  }
  .sb-search::placeholder { color: var(--muted); }
  .sb-search:focus { border-color: rgba(201,168,76,0.4); }

  .sb-sort, .sb-cat-select {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 12px 14px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; color: var(--body);
    outline: none; cursor: pointer;
  }

  .sb-classic-toggle {
    display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--body);
    cursor: pointer; user-select: none; white-space: nowrap;
  }

  /* ── Kompakt rad ── */
  .sb-row {
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 12px 16px; margin-bottom: 8px; cursor: pointer;
    display: flex; align-items: center; gap: 12px;
    transition: border-color 0.15s;
  }
  .sb-row:hover { border-color: rgba(201,168,76,0.25); }
  .sb-row-chevron {
    flex-shrink: 0; color: var(--muted); transition: transform 0.15s; display: flex;
  }
  .sb-row-chevron.open { transform: rotate(90deg); }
  .sb-row-text {
    flex: 1; min-width: 0; font-size: 14px; color: var(--white); font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sb-row-badges { display: flex; gap: 6px; align-items: center; flex-shrink: 0; flex-wrap: nowrap; }

  .sb-card {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--rcard);
    border-top: none; border-top-left-radius: 0; border-top-right-radius: 0;
    padding: 20px; margin-top: -8px; margin-bottom: 8px;
  }
  .sb-opts { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .sb-opt { font-size: 13px; color: var(--body); }
  .sb-opt.correct { color: var(--green); font-weight: 600; }
  .sb-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  .sb-tag {
    font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    border-radius: 20px; padding: 2px 8px; white-space: nowrap;
  }
  .sb-tag-gold { color: var(--gold); background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.18); }
  .sb-tag-muted { color: var(--muted); background: var(--bg); border: 1px solid var(--border); }
  .sb-explanation { font-size: 12px; color: var(--muted); font-style: italic; margin-bottom: 12px; }
  .sb-footer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .sb-quiz-name { font-size: 12px; color: var(--muted); }

  .sb-copy-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .sb-select {
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 7px 12px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; color: var(--body);
    cursor: pointer; outline: none; min-width: 160px; flex: 1;
  }
  .sb-btn-copy {
    background: transparent; border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 7px 16px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; font-weight: 600;
    color: var(--body); cursor: pointer; transition: border-color 0.15s, color 0.15s; white-space: nowrap;
  }
  .sb-btn-copy:hover { border-color: rgba(201,168,76,0.4); color: var(--white); }
  .sb-btn-copy.done { color: var(--green); border-color: rgba(74,222,128,0.3); }
  .sb-btn-copy:disabled { opacity: 0.5; cursor: not-allowed; }

  .sb-empty { text-align: center; padding: 60px 20px; color: var(--muted); font-size: 15px; }
  .sb-count { font-size: 13px; color: var(--muted); margin-bottom: 16px; }

  .sb-load-more-row { display: flex; justify-content: center; margin-top: 16px; }
  .sb-btn-load-more {
    background: transparent; border: 1px solid var(--border); border-radius: var(--rbtn);
    padding: 10px 28px; font-family: 'Instrument Sans', sans-serif; font-size: 13px; font-weight: 600;
    color: var(--body); cursor: pointer; transition: border-color 0.15s, color 0.15s;
  }
  .sb-btn-load-more:hover { border-color: rgba(201,168,76,0.4); color: var(--white); }

  @media (max-width: 520px) {
    .sb-controls { flex-direction: column; align-items: stretch; }
    .sb-row-text { white-space: normal; }
  }
`

function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function hitRateLabel(q: BankQuestion): string {
  if (!q.answer_count) return 'Ingen data'
  return `${q.hit_rate}% riktig`
}

export default function SporsmalPage() {
  const router = useRouter()
  const [questions, setQuestions] = useState<BankQuestion[]>([])
  const [quizzes,   setQuizzes]   = useState<QuizOption[]>([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [sortKey,   setSortKey]   = useState<SortKey>('last_used')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [classicOnly, setClassicOnly] = useState(false)
  const [copying,   setCopying]   = useState<string | null>(null)
  const [copyDone,  setCopyDone]  = useState<string | null>(null)
  const [targetMap, setTargetMap] = useState<Record<string, string>>({})
  // Synkron sperre PER MÅLQUIZ — se samme begrunnelse i app/admin/classics/page.tsx.
  const copyInFlightRef = useRef<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.replace(adminLoginPath()); return }
    Promise.all([
      adminFetch('/api/admin/questions').then(r => r.json()),
      adminFetch('/api/admin/quizzes').then(r => r.json()),
    ]).then(([qData, quizData]) => {
      setQuestions(qData.questions ?? [])
      setQuizzes((Array.isArray(quizData) ? quizData : []).map((q: { id: string; title: string }) => ({ id: q.id, title: q.title })))
    }).finally(() => setLoading(false))
  }, [router])

  const categories = useMemo(
    () => [...new Set(questions.map(q => q.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'nb')),
    [questions]
  )

  // Reset paginering når filter/søk/sortering endres, så man ikke blir
  // stående midt i en avkuttet liste med feil resultater synlige.
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [search, sortKey, categoryFilter, classicOnly])

  const filtered = useMemo(() => {
    let list = questions
    if (classicOnly) list = list.filter(q => q.is_classic)
    if (categoryFilter) list = list.filter(q => q.category === categoryFilter)
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(q => q.question_text.toLowerCase().includes(s) || (q.category ?? '').toLowerCase().includes(s))
    }
    const sorted = [...list]
    switch (sortKey) {
      case 'most_used':
        sorted.sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0))
        break
      case 'least_used':
        sorted.sort((a, b) => (a.usage_count ?? 0) - (b.usage_count ?? 0))
        break
      case 'newest':
        sorted.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
        break
      case 'alphabetical':
        sorted.sort((a, b) => a.question_text.localeCompare(b.question_text, 'nb'))
        break
      case 'hit_rate_asc':
        // Spørsmål uten svardata er ikke "vanskelige" — de er ukjente, så de
        // sorteres bakerst i stedet for å blandes inn blant lave treffprosenter.
        sorted.sort((a, b) => {
          if (!a.answer_count && !b.answer_count) return 0
          if (!a.answer_count) return 1
          if (!b.answer_count) return -1
          return (a.hit_rate ?? 0) - (b.hit_rate ?? 0)
        })
        break
      case 'last_used':
      default:
        sorted.sort((a, b) => new Date(b.last_used_at ?? 0).getTime() - new Date(a.last_used_at ?? 0).getTime())
    }
    return sorted
  }, [questions, search, sortKey, classicOnly, categoryFilter])

  const visible = filtered.slice(0, visibleCount)

  async function copyToQuiz(questionId: string) {
    const targetQuizId = targetMap[questionId]
    if (!targetQuizId) return
    // Synkron sperre og claim FØR alt annet — se copyInFlightRef sin begrunnelse
    // i app/admin/classics/page.tsx.
    if (copyInFlightRef.current.has(targetQuizId)) return
    copyInFlightRef.current.add(targetQuizId)
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
      copyInFlightRef.current.delete(targetQuizId)
      setCopying(null)
    }
  }

  const optMap: Record<string, 'option_a' | 'option_b' | 'option_c' | 'option_d'> = {
    A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d',
  }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="sb-page">
        <div className="sb-header"><p style={{ color: '#918f8a', fontSize: 14, paddingTop: 40 }}>Laster spørsmålsbank…</p></div>
      </div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="sb-page">

        <header className="sb-header">
          <div>
            <Link href="/admin/quizzes" className="sb-back">← Tilbake til quizer</Link>
            <h1 className="sb-title">Spørsmåls<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>banken</em></h1>
          </div>
        </header>

        <div className="sb-rule" />

        <div className="sb-controls">
          <input
            className="sb-search"
            type="text"
            placeholder="Søk på spørsmål eller kategori…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="sb-cat-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="">Alle kategorier</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="sb-sort" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
            <option value="last_used">Sist brukt</option>
            <option value="most_used">Mest brukt</option>
            <option value="least_used">Minst brukt</option>
            <option value="newest">Nyeste</option>
            <option value="alphabetical">Alfabetisk</option>
            <option value="hit_rate_asc">Treffprosent (lavest først)</option>
          </select>
          <label className="sb-classic-toggle">
            <input type="checkbox" checked={classicOnly} onChange={e => setClassicOnly(e.target.checked)} />
            Kun klassikere
          </label>
        </div>

        {filtered.length > 0 && (
          <p className="sb-count">
            {filtered.length} spørsmål{search || classicOnly || categoryFilter ? ' funnet' : ''}
            {visible.length < filtered.length ? ` — viser ${visible.length}` : ''}
          </p>
        )}

        {filtered.length === 0 ? (
          <div className="sb-empty">
            {search || classicOnly || categoryFilter ? 'Ingen spørsmål matcher filteret.' : 'Ingen spørsmål ennå.'}
          </div>
        ) : (
          <>
            {visible.map(q => {
              const correctKeys = q.correct_answers && q.correct_answers.length > 0 ? q.correct_answers : [q.correct_answer]
              const opts = (['A', 'B', 'C', 'D'] as const).filter(o => q[optMap[o]])
              const isOpen = expandedId === q.id
              return (
                <div key={q.id}>
                  <div
                    className="sb-row"
                    onClick={() => setExpandedId(isOpen ? null : q.id)}
                  >
                    <span className={`sb-row-chevron${isOpen ? ' open' : ''}`}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 6 15 12 9 18" />
                      </svg>
                    </span>
                    <span className="sb-row-text">{q.question_text}</span>
                    <div className="sb-row-badges">
                      {q.category && <span className="sb-tag sb-tag-gold">{q.category}</span>}
                      <span className="sb-tag sb-tag-muted">{q.usage_count ?? 0}x</span>
                      <span className="sb-tag sb-tag-muted">{hitRateLabel(q)}</span>
                      <span className="sb-tag sb-tag-muted">{formatShortDate(q.last_used_at)}</span>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="sb-card">
                      <div className="sb-opts">
                        {opts.map(o => (
                          <p key={o} className={`sb-opt ${correctKeys.includes(o) ? 'correct' : ''}`}>
                            <strong>{o}: </strong>{q[optMap[o]]}{correctKeys.includes(o) ? ' ✓' : ''}
                          </p>
                        ))}
                      </div>

                      <div className="sb-meta">
                        {q.is_classic && <span className="sb-tag sb-tag-gold">Klassiker</span>}
                        <span className="sb-tag sb-tag-muted">Brukt {q.usage_count ?? 0} {(q.usage_count ?? 0) === 1 ? 'gang' : 'ganger'}</span>
                        <span className="sb-tag sb-tag-muted">
                          {q.answer_count ? `${q.hit_rate}% riktig (${q.answer_count} svar)` : 'Ingen svardata ennå'}
                        </span>
                      </div>

                      {q.explanation && <p className="sb-explanation">{q.explanation}</p>}

                      <div className="sb-footer">
                        <p className="sb-quiz-name">Fra: {q.quiz_title ?? q.quiz_id}</p>
                        <div className="sb-copy-row" style={{ marginLeft: 'auto' }}>
                          <select
                            className="sb-select"
                            value={targetMap[q.id] ?? ''}
                            onChange={e => setTargetMap(prev => ({ ...prev, [q.id]: e.target.value }))}
                          >
                            <option value="">Velg quiz…</option>
                            {quizzes.map(qz => (
                              <option key={qz.id} value={qz.id}>{qz.title}</option>
                            ))}
                          </select>
                          <button
                            className={`sb-btn-copy ${copyDone === q.id ? 'done' : ''}`}
                            disabled={!targetMap[q.id] || copying === q.id}
                            onClick={() => copyToQuiz(q.id)}
                          >
                            {copyDone === q.id ? 'Lagt til!' : copying === q.id ? 'Kopierer…' : 'Legg til i quiz'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {visible.length < filtered.length && (
              <div className="sb-load-more-row">
                <button className="sb-btn-load-more" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
                  Last flere ({filtered.length - visible.length} igjen)
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </>
  )
}
