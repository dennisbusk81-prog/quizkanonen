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

const toISO = (local: string) => new Date(local).toISOString()

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

  const Toggle = ({ label, field }: { label: string; field: string }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-800 last:border-0">
      <span className="text-gray-300 text-sm">{label}</span>
      <button onClick={() => upd(field, !(form as any)[field])}
        className={`w-12 h-6 rounded-full transition-all relative ${(form as any)[field] ? 'bg-yellow-400' : 'bg-gray-700'}`}>
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${(form as any)[field] ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-white animate-pulse">Laster...</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/admin/quizzes" className="text-gray-400 hover:text-white text-sm mb-2 inline-block">← Alle quizer</Link>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black text-white">🎛️ {form.title || 'Quiz-cockpit'}</h1>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${form.is_active ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
            {form.is_active ? 'Publisert' : 'Skjult'}
          </span>
        </div>

        {feedback && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-semibold ${feedback.type === 'success' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
          </div>
        )}

        {/* Snarveier */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Link href={`/admin/quizzes/${quizId}/questions`}
            className="bg-blue-900 hover:bg-blue-800 text-blue-200 rounded-2xl p-4 text-center transition-all">
            <p className="text-2xl mb-1">❓</p>
            <p className="font-bold text-sm">Spørsmål</p>
            <p className="text-xs text-blue-400 mt-0.5">{stats.questions} stk</p>
          </Link>
          <Link href={`/admin/quizzes/${quizId}/analytics`}
            className="bg-gray-900 hover:bg-gray-800 text-gray-200 rounded-2xl p-4 text-center transition-all border border-gray-800">
            <p className="text-2xl mb-1">📊</p>
            <p className="font-bold text-sm">Analytics</p>
            <p className="text-xs text-gray-400 mt-0.5">{stats.plays} spill</p>
          </Link>
          <Link href={`/quiz/${quizId}`} target="_blank"
            className="bg-gray-900 hover:bg-gray-800 text-gray-200 rounded-2xl p-4 text-center transition-all border border-gray-800">
            <p className="text-2xl mb-1">👁️</p>
            <p className="font-bold text-sm">Forhåndsvis</p>
            <p className="text-xs text-gray-400 mt-0.5">Åpner i ny fane</p>
          </Link>
        </div>

        {/* Grunninfo */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-4">
          <h2 className="text-white font-bold mb-4">Grunninfo</h2>
          <div className="space-y-3">
            <div>
              <label className="text-gray-400 text-xs font-semibold mb-1 block">Tittel</label>
              <input type="text" value={form.title} onChange={e => upd('title', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-yellow-400" />
            </div>
            <div>
              <label className="text-gray-400 text-xs font-semibold mb-1 block">Beskrivelse</label>
              <textarea value={form.description} onChange={e => upd('description', e.target.value)}
                rows={2} className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-yellow-400 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs font-semibold mb-1 block">📅 Åpner</label>
                <input type="datetime-local" value={form.opens_at} onChange={e => upd('opens_at', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-yellow-400" />
              </div>
              <div>
                <label className="text-gray-400 text-xs font-semibold mb-1 block">🔒 Stenger</label>
                <input type="datetime-local" value={form.closes_at} onChange={e => upd('closes_at', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-yellow-400" />
              </div>
            </div>
            <div>
              <label className="text-gray-400 text-xs font-semibold mb-1 block">⏰ Auto-publiser (valgfritt)</label>
              <input
                type="datetime-local"
                value={form.scheduled_at}
                onChange={e => {
                  upd('scheduled_at', e.target.value)
                  if (e.target.value) upd('is_active', false)
                }}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-yellow-400"
              />
              <p className="text-gray-500 text-xs mt-1">Publiseres automatisk på dette tidspunktet. Tøm feltet for å deaktivere.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs font-semibold mb-1 block">⏱️ Tid per spørsmål: {form.time_limit_seconds}s</label>
                <input type="range" min={10} max={120} value={form.time_limit_seconds}
                  onChange={e => upd('time_limit_seconds', parseInt(e.target.value))}
                  className="w-full accent-yellow-400" />
              </div>
              <div>
                <label className="text-gray-400 text-xs font-semibold mb-1 block">Antall svaralternativer</label>
                <div className="flex gap-2">
                  {[2, 3, 4].map(n => (
                    <button key={n} onClick={() => upd('num_options', n)}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${form.num_options === n ? 'bg-yellow-400 text-gray-950' : 'bg-gray-800 text-white'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Innstillinger */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-4">
          <h2 className="text-white font-bold mb-2">Innstillinger</h2>
          <Toggle label="Publisert (synlig for spillere)" field="is_active" />
          <Toggle label="Vis leaderboard" field="show_leaderboard" />
          <Toggle label="Skjul leaderboard til quiz stenger" field="hide_leaderboard_until_closed" />
          <Toggle label="Vis plassering underveis" field="show_live_placement" />
          <Toggle label="Vis forklaring etter svar" field="show_answer_explanation" />
          <Toggle label="Tilfeldig rekkefølge på spørsmål" field="randomize_questions" />
          <Toggle label="Tillat lag" field="allow_teams" />
          <Toggle label="Krev verdikode" field="requires_access_code" />
        </div>

        {/* Lagre */}
        <button onClick={saveQuiz} disabled={saving}
          className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-950 font-black py-3 rounded-2xl text-lg transition-all mb-4">
          {saving ? 'Lagrer...' : '💾 Lagre endringer'}
        </button>

        {/* Farlige handlinger */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-bold mb-3">Handlinger</h2>
          <div className="flex gap-3">
            <button onClick={resetQuiz}
              className="flex-1 bg-purple-900 hover:bg-purple-800 text-purple-200 py-2.5 rounded-xl font-semibold text-sm transition-all">
              🔄 Nullstill resultater
            </button>
            <button onClick={deleteQuiz}
              className="flex-1 bg-red-900 hover:bg-red-800 text-red-200 py-2.5 rounded-xl font-semibold text-sm transition-all">
              🗑️ Slett quiz
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}