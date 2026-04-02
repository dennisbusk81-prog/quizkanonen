'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { supabase, Quiz } from '@/lib/supabase'
import Link from 'next/link'

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
    --radius-card: 20px;
    --radius-btn:  10px;
  }

  body {
    background: var(--bg);
    font-family: 'Instrument Sans', sans-serif;
    color: var(--body);
    min-height: 100vh;
  }

  .aqz-page { max-width: 860px; margin: 0 auto; padding: 0 20px 80px; }

  .aqz-header {
    padding: 48px 0 36px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .aqz-back {
    font-size: 12px;
    color: var(--muted);
    text-decoration: none;
    display: block;
    margin-bottom: 8px;
    transition: color 0.15s;
  }

  .aqz-back:hover { color: var(--gold); }

  .aqz-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--white);
    letter-spacing: -0.01em;
  }

  .aqz-title em { font-style: italic; color: var(--gold); }

  .aqz-btn-primary {
    background: var(--gold);
    color: #0f0f10;
    font-family: 'Instrument Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    padding: 10px 18px;
    border-radius: var(--radius-btn);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.15s;
    display: inline-block;
  }

  .aqz-btn-primary:hover { background: #d9b85c; }

  .aqz-rule { width: 100%; height: 1px; background: var(--border); margin-bottom: 24px; }

  /* Feedback */
  .aqz-feedback {
    border-radius: var(--radius-btn);
    padding: 12px 16px;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 16px;
  }

  .aqz-feedback.success { background: rgba(74,222,128,0.10); color: #4ade80; border: 1px solid rgba(74,222,128,0.2); }
  .aqz-feedback.error   { background: rgba(248,113,113,0.10); color: #f87171; border: 1px solid rgba(248,113,113,0.2); }

  /* Quiz card */
  .aqz-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 20px 24px;
    margin-bottom: 10px;
  }

  .aqz-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
    flex-wrap: wrap;
  }

  .aqz-card-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }

  .aqz-card-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 17px;
    font-weight: 700;
    color: var(--white);
  }

  .aqz-badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 20px;
  }

  .aqz-badge.open   { background: rgba(74,222,128,0.12); color: var(--green); border: 1px solid rgba(74,222,128,0.2); }
  .aqz-badge.closed { background: rgba(96,165,250,0.10); color: #60a5fa;     border: 1px solid rgba(96,165,250,0.2); }
  .aqz-badge.hidden { background: var(--border);         color: var(--muted); border: 1px solid var(--border); }

  .aqz-card-desc { font-size: 13px; color: var(--muted); }

  .aqz-card-meta {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 6px;
  }

  .aqz-card-meta span { font-size: 12px; color: var(--muted); }

  /* Action buttons */
  .aqz-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .aqz-action {
    font-size: 12px;
    font-weight: 500;
    padding: 6px 12px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    transition: opacity 0.15s;
    font-family: 'Instrument Sans', sans-serif;
  }

  .aqz-action:hover { opacity: 0.8; }

  .aqz-action.blue   { background: rgba(96,165,250,0.12); color: #60a5fa; }
  .aqz-action.gray   { background: rgba(255,255,255,0.06); color: var(--body); }
  .aqz-action.orange { background: rgba(251,146,60,0.12); color: #fb923c; }
  .aqz-action.green  { background: rgba(74,222,128,0.12); color: var(--green); }
  .aqz-action.purple { background: rgba(167,139,250,0.12); color: #a78bfa; }
  .aqz-action.red    { background: rgba(248,113,113,0.10); color: #f87171; }

  /* Empty */
  .aqz-empty {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    padding: 56px 32px;
    text-align: center;
  }

  .aqz-empty-title {
    font-family: 'Libre Baskerville', serif;
    font-size: 20px;
    color: var(--white);
    margin-bottom: 8px;
  }

  .aqz-empty-sub { font-size: 13px; color: var(--muted); margin-bottom: 24px; }

  .aqz-loading {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .aqz-loading p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: var(--muted);
    font-style: italic;
  }
`

export default function AdminQuizzes() {
  const router = useRouter()
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    console.log('[AdminQuizzes] useEffect kjører')
    setMounted(true)
    console.log('[AdminQuizzes] før isAdminLoggedIn()')
    const loggedIn = isAdminLoggedIn()
    console.log('[AdminQuizzes] etter isAdminLoggedIn(), resultat:', loggedIn)
    if (!loggedIn) { router.push('/admin/login'); setLoading(false); return }
    fetchQuizzes()
  }, [])

  function showFeedback(type: 'success' | 'error', msg: string) {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3500)
  }

  async function fetchQuizzes() {
    console.log('[AdminQuizzes] fetchQuizzes starter')
    try {
      console.log('[AdminQuizzes] før Supabase-kall')
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase-kall tidsavbrutt etter 10s')), 10_000)
      )
      const { data, error } = await Promise.race([
        supabase.from('quizzes').select('*').order('created_at', { ascending: false }),
        timeout,
      ])
      console.log('[AdminQuizzes] etter Supabase-kall, data:', data, 'error:', error)
      if (error) throw error
      setQuizzes(data || [])
    } catch (e) {
      console.error('fetchQuizzes feilet:', e)
    } finally {
      setLoading(false)
    }
  }

  async function toggleActive(quiz: Quiz) {
    try {
      await supabase.from('quizzes').update({ is_active: !quiz.is_active }).eq('id', quiz.id)
      fetchQuizzes()
    } catch {
      showFeedback('error', 'Kunne ikke oppdatere quiz.')
    }
  }

  async function deleteQuiz(id: string) {
    if (!confirm('Er du sikker på at du vil slette denne quizen? Dette kan ikke angres.')) return
    try {
      await supabase.from('quizzes').delete().eq('id', id)
      fetchQuizzes()
    } catch {
      showFeedback('error', 'Kunne ikke slette quiz.')
    }
  }

  async function resetQuiz(id: string, title: string) {
    if (!confirm(`Nullstill "${title}"? Dette sletter alle resultater og lar alle spille på nytt.`)) return
    try {
      const { data: attempts } = await supabase.from('attempts').select('id').eq('quiz_id', id)
      if (attempts && attempts.length > 0) {
        const attemptIds = attempts.map((a: { id: string }) => a.id)
        await supabase.from('attempt_answers').delete().in('attempt_id', attemptIds)
        await supabase.from('attempts').delete().eq('quiz_id', id)
      }
      await supabase.from('played_log').delete().eq('quiz_id', id)
      showFeedback('success', `"${title}" er nullstilt — alle kan spille igjen.`)
      fetchQuizzes()
    } catch {
      showFeedback('error', `Kunne ikke nullstille "${title}".`)
    }
  }

  const isOpen = (quiz: Quiz) => {
    if (!mounted) return false
    const now = new Date()
    return new Date(quiz.opens_at) <= now && new Date(quiz.closes_at) >= now
  }

  const formatDate = (d: string) => new Date(d).toLocaleString('no-NO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })

  const statusBadge = (quiz: Quiz) => {
    if (!quiz.is_active) return <span className="aqz-badge hidden">Skjult</span>
    if (isOpen(quiz)) return <span className="aqz-badge open">● Åpen</span>
    return <span className="aqz-badge closed">Stengt</span>
  }

  if (loading) return (
    <>
      <style>{STYLES}</style>
      <div className="aqz-loading"><p>Laster quizer...</p></div>
    </>
  )

  return (
    <>
      <style>{STYLES}</style>
      <div className="aqz-page">

        <header className="aqz-header">
          <div>
            <Link href="/admin" className="aqz-back">← Admin</Link>
            <h1 className="aqz-title">Alle <em>quizer</em></h1>
          </div>
          <Link href="/admin/quizzes/new" className="aqz-btn-primary">+ Ny quiz</Link>
        </header>

        <div className="aqz-rule" />

        {feedback && (
          <div className={`aqz-feedback ${feedback.type}`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
          </div>
        )}

        {quizzes.length === 0 ? (
          <div className="aqz-empty">
            <p className="aqz-empty-title">Ingen quizer ennå</p>
            <p className="aqz-empty-sub">Lag din første quiz for å komme i gang.</p>
            <Link href="/admin/quizzes/new" className="aqz-btn-primary">Lag din første quiz</Link>
          </div>
        ) : (
          <div>
            {quizzes.map(quiz => (
              <div key={quiz.id} className="aqz-card">
                <div className="aqz-card-top">
                  <div className="flex-1 min-w-0">
                    <div className="aqz-card-title-row">
                      <h2 className="aqz-card-title">{quiz.title}</h2>
                      {statusBadge(quiz)}
                    </div>
                    {quiz.description && (
                      <p className="aqz-card-desc">{quiz.description}</p>
                    )}
                    <div className="aqz-card-meta">
                      <span>📅 {formatDate(quiz.opens_at)}</span>
                      <span>🔒 {formatDate(quiz.closes_at)}</span>
                      <span>⏱ {quiz.time_limit_seconds}s</span>
                    </div>
                  </div>
                </div>

                <div className="aqz-actions">
                  <Link href={`/admin/quizzes/${quiz.id}/questions`} className="aqz-action blue">
                    Spørsmål
                  </Link>
                  <Link href={`/admin/quizzes/${quiz.id}`} className="aqz-action gray">
                    Rediger
                  </Link>
                  <Link href={`/admin/quizzes/${quiz.id}/analytics`} className="aqz-action gray">
                    Analytics
                  </Link>
                  <button onClick={() => toggleActive(quiz)}
                    className={`aqz-action ${quiz.is_active ? 'orange' : 'green'}`}>
                    {quiz.is_active ? 'Skjul' : 'Publiser'}
                  </button>
                  <button onClick={() => resetQuiz(quiz.id, quiz.title)} className="aqz-action purple">
                    Reset
                  </button>
                  <button onClick={() => deleteQuiz(quiz.id)} className="aqz-action red">
                    Slett
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}