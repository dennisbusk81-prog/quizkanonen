'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { adminFetch } from '@/lib/admin-fetch'
import { Quiz } from '@/lib/supabase'
import Link from 'next/link'

const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const toISO = (local: string): string => {
  const [datePart, timePart] = local.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hours, minutes] = timePart.split(':').map(Number)
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0)
  return d.toISOString()
}

const s = {
  page:       { minHeight: '100vh', background: '#1a1c23', padding: '32px 16px', fontFamily: "'Instrument Sans', sans-serif" } as React.CSSProperties,
  inner:      { maxWidth: 680, margin: '0 auto' } as React.CSSProperties,
  backLink:   { fontSize: 12, color: '#7a7873', textDecoration: 'none', display: 'inline-block', marginBottom: 16 } as React.CSSProperties,
  header:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 } as React.CSSProperties,
  h1:         { fontSize: 22, fontWeight: 700, color: '#ffffff', margin: 0 } as React.CSSProperties,
  badge:      (active: boolean): React.CSSProperties => ({
    fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
    background: active ? 'rgba(76,175,125,0.12)' : 'transparent',
    border: `1px solid ${active ? 'rgba(76,175,125,0.3)' : '#2a2d38'}`,
    color: active ? '#4caf7d' : '#7a7873',
  }),
  feedback:   (type: 'success' | 'error'): React.CSSProperties => ({
    marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
    background: type === 'success' ? 'rgba(76,175,125,0.1)' : 'rgba(201,76,76,0.1)',
    border: `1px solid ${type === 'success' ? 'rgba(76,175,125,0.25)' : 'rgba(201,76,76,0.25)'}`,
    color: type === 'success' ? '#4caf7d' : '#c94c4c',
  }),
  navGrid:    { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 } as React.CSSProperties,
  navCard:    { display: 'block', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, padding: '14px 12px', textAlign: 'center' as const, textDecoration: 'none' },
  navTitle:   { fontSize: 13, fontWeight: 600, color: '#e8e4dd', marginBottom: 2 } as React.CSSProperties,
  navSub:     { fontSize: 11, color: '#7a7873' } as React.CSSProperties,
  card:       { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px 20px', marginBottom: 16 } as React.CSSProperties,
  h2:         { fontSize: 14, fontWeight: 600, color: '#ffffff', margin: '0 0 16px' } as React.CSSProperties,
  label:      { fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#7a7873', display: 'block', marginBottom: 6 } as React.CSSProperties,
  input:      { width: '100%', background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', color: '#ffffff', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const } as React.CSSProperties,
  hint:       { fontSize: 11, color: '#7a7873', marginTop: 4 } as React.CSSProperties,
  row2:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as React.CSSProperties,
  toggleRow:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #2a2d38' } as React.CSSProperties,
  toggleLast: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' } as React.CSSProperties,
  saveBtn:    { width: '100%', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: 10, padding: '12px', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 16, fontFamily: 'inherit' } as React.CSSProperties,
  outlineBtn: { flex: 1, background: 'transparent', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 600, color: '#e8e4dd', cursor: 'pointer', fontFamily: 'inherit' } as React.CSSProperties,
}

export default function QuizCockpit() {
  const params = useParams()
  const router = useRouter()
  const quizId = params.id as string

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [stats, setStats] = useState({ plays: 0, questions: 0 })

  const [form, setForm] = useState({
    title: '',
    description: '',
    opens_at: '',
    closes_at: '',
    scheduled_at: '',
    time_limit_seconds: 30,
    num_options: 4,
    is_active: false,
    show_leaderboard: true,
    hide_leaderboard_until_closed: true,
    show_live_placement: true,
    show_answer_explanation: true,
    randomize_questions: false,
    allow_teams: true,
    requires_access_code: false,
  })

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); setLoading(false); return }
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await adminFetch(`/api/admin/quizzes/${quizId}`)
      if (!res.ok) throw new Error(`API svarte ${res.status}`)
      const { quiz: quizData, plays, questions_count } = await res.json()
      if (quizData) {
        setQuiz(quizData)
        setForm({
          title: quizData.title,
          description: quizData.description || '',
          opens_at: toLocalInput(quizData.opens_at),
          closes_at: toLocalInput(quizData.closes_at),
          scheduled_at: quizData.scheduled_at ? toLocalInput(quizData.scheduled_at) : '',
          time_limit_seconds: quizData.time_limit_seconds,
          num_options: quizData.num_options,
          is_active: quizData.is_active,
          show_leaderboard: quizData.show_leaderboard,
          hide_leaderboard_until_closed: quizData.hide_leaderboard_until_closed,
          show_live_placement: quizData.show_live_placement,
          show_answer_explanation: quizData.show_answer_explanation,
          randomize_questions: quizData.randomize_questions,
          allow_teams: quizData.allow_teams,
          requires_access_code: quizData.requires_access_code,
        })
      }
      setStats({ plays, questions: questions_count })
    } catch (e) {
      console.error('fetchData feilet:', e)
    } finally {
      setLoading(false)
    }
  }

  function showFeedback(type: 'success' | 'error', msg: string) {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3000)
  }

  async function saveQuiz() {
    setSaving(true)
    try {
      const res = await adminFetch(`/api/admin/quizzes/${quizId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          opens_at: toISO(form.opens_at),
          closes_at: toISO(form.closes_at),
          scheduled_at: form.scheduled_at ? toISO(form.scheduled_at) : null,
          time_limit_seconds: form.time_limit_seconds,
          num_options: form.num_options,
          is_active: form.is_active,
          show_leaderboard: form.show_leaderboard,
          hide_leaderboard_until_closed: form.hide_leaderboard_until_closed,
          show_live_placement: form.show_live_placement,
          show_answer_explanation: form.show_answer_explanation,
          randomize_questions: form.randomize_questions,
          allow_teams: form.allow_teams,
          requires_access_code: form.requires_access_code,
        }),
      })
      if (!res.ok) { const d = await res.json(); showFeedback('error', 'Feil ved lagring: ' + d.error) }
      else { showFeedback('success', 'Quiz lagret!'); fetchData() }
    } catch {
      showFeedback('error', 'Uventet feil ved lagring.')
    } finally {
      setSaving(false)
    }
  }

  async function resetQuiz() {
    if (!confirm(`Nullstill "${form.title}"? Dette sletter alle resultater og lar alle spille på nytt.`)) return
    try {
      const res = await adminFetch(`/api/admin/quizzes/${quizId}/reset`, { method: 'POST' })
      if (!res.ok) showFeedback('error', 'Kunne ikke nullstille quizen.')
      else { showFeedback('success', 'Quiz nullstilt — alle kan spille igjen.'); fetchData() }
    } catch {
      showFeedback('error', 'Kunne ikke nullstille quizen.')
    }
  }

  async function deleteQuiz() {
    if (!confirm(`Slett "${form.title}" permanent? Dette kan ikke angres.`)) return
    try {
      const res = await adminFetch(`/api/admin/quizzes/${quizId}`, { method: 'DELETE' })
      if (!res.ok) showFeedback('error', 'Kunne ikke slette quizen.')
      else router.push('/admin/quizzes')
    } catch {
      showFeedback('error', 'Kunne ikke slette quizen.')
    }
  }

  const upd = (key: string, val: unknown) => setForm(f => ({ ...f, [key]: val }))

  const toggleFields = [
    { label: 'Publisert (synlig for spillere)', field: 'is_active' },
    { label: 'Vis leaderboard', field: 'show_leaderboard' },
    { label: 'Skjul leaderboard til quiz stenger', field: 'hide_leaderboard_until_closed' },
    { label: 'Vis plassering underveis', field: 'show_live_placement' },
    { label: 'Vis forklaring etter svar', field: 'show_answer_explanation' },
    { label: 'Tilfeldig rekkefølge på spørsmål', field: 'randomize_questions' },
    { label: 'Tillat lag', field: 'allow_teams' },
    { label: 'Krev verdikode', field: 'requires_access_code' },
  ]

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif" }}>Laster...</p>
    </div>
  )

  return (
    <main style={s.page}>
      <div style={s.inner}>
        <Link href="/admin/quizzes" style={s.backLink}>← Alle quizer</Link>

        <div style={s.header}>
          <h1 style={s.h1}>{form.title || 'Quiz-cockpit'}</h1>
          <span style={s.badge(form.is_active)}>{form.is_active ? 'Publisert' : 'Skjult'}</span>
        </div>

        {feedback && (
          <div style={s.feedback(feedback.type)}>{feedback.msg}</div>
        )}

        {/* Navigasjon */}
        <div style={s.navGrid}>
          <Link href={`/admin/quizzes/${quizId}/questions`} style={s.navCard}>
            <p style={s.navTitle}>Spørsmål</p>
            <p style={s.navSub}>{stats.questions} stk</p>
          </Link>
          <Link href={`/admin/quizzes/${quizId}/analytics`} style={s.navCard}>
            <p style={s.navTitle}>Analytics</p>
            <p style={s.navSub}>{stats.plays} spill</p>
          </Link>
          <Link href={`/quiz/${quizId}`} target="_blank" style={s.navCard}>
            <p style={s.navTitle}>Forhåndsvis</p>
            <p style={s.navSub}>Åpner i ny fane</p>
          </Link>
        </div>

        {/* Grunninfo */}
        <div style={s.card}>
          <h2 style={s.h2}>Grunninfo</h2>

          <div style={{ marginBottom: 12 }}>
            <label style={s.label}>Tittel</label>
            <input type="text" value={form.title} onChange={e => upd('title', e.target.value)} style={s.input} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={s.label}>Beskrivelse</label>
            <textarea value={form.description} onChange={e => upd('description', e.target.value)}
              rows={2} style={{ ...s.input, resize: 'none' }} />
          </div>

          <div style={{ ...s.row2, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Åpner</label>
              <input type="datetime-local" value={form.opens_at} onChange={e => upd('opens_at', e.target.value)} style={s.input} />
            </div>
            <div>
              <label style={s.label}>Stenger</label>
              <input type="datetime-local" value={form.closes_at} onChange={e => upd('closes_at', e.target.value)} style={s.input} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={s.label}>Auto-publiser (valgfritt)</label>
            <input type="datetime-local" value={form.scheduled_at}
              onChange={e => { upd('scheduled_at', e.target.value); if (e.target.value) upd('is_active', false) }}
              style={s.input} />
            <p style={s.hint}>Publiseres automatisk på dette tidspunktet. Tøm feltet for å deaktivere.</p>
          </div>

          <div style={s.row2}>
            <div>
              <label style={s.label}>Tid per spørsmål: {form.time_limit_seconds}s</label>
              <input type="range" min={10} max={120} value={form.time_limit_seconds}
                onChange={e => upd('time_limit_seconds', parseInt(e.target.value))}
                style={{ width: '100%', accentColor: '#c9a84c' }} />
            </div>
            <div>
              <label style={s.label}>Antall svaralternativer</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[2, 3, 4].map(n => (
                  <button key={n} onClick={() => upd('num_options', n)} style={{
                    flex: 1, padding: '8px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                    background: form.num_options === n ? '#c9a84c' : 'transparent',
                    color: form.num_options === n ? '#1a1c23' : '#e8e4dd',
                    border: `1px solid ${form.num_options === n ? '#c9a84c' : '#2a2d38'}`,
                  }}>{n}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Innstillinger */}
        <div style={s.card}>
          <h2 style={s.h2}>Innstillinger</h2>
          {toggleFields.map(({ label, field }, i) => {
            const on = (form as Record<string, unknown>)[field] as boolean
            const isLast = i === toggleFields.length - 1
            return (
              <div key={field} style={isLast ? s.toggleLast : s.toggleRow}>
                <span style={{ color: '#e8e4dd', fontSize: 14 }}>{label}</span>
                <button onClick={() => upd(field, !on)} style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: on ? '#c9a84c' : '#2a2d38', position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                }}>
                  <span style={{
                    position: 'absolute', top: 3, width: 18, height: 18, background: '#fff', borderRadius: '50%',
                    left: on ? 23 : 3, transition: 'left 0.2s',
                  }} />
                </button>
              </div>
            )
          })}
        </div>

        {/* Lagre */}
        <button onClick={saveQuiz} disabled={saving} style={{ ...s.saveBtn, opacity: saving ? 0.5 : 1 }}>
          {saving ? 'Lagrer...' : 'Lagre endringer'}
        </button>

        {/* Handlinger */}
        <div style={s.card}>
          <h2 style={s.h2}>Handlinger</h2>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={resetQuiz} style={s.outlineBtn}>Nullstill resultater</button>
            <button onClick={deleteQuiz} style={s.outlineBtn}>Slett quiz</button>
          </div>
        </div>
      </div>
    </main>
  )
}
