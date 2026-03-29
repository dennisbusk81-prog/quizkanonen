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
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
    fetchData()
  }, [])

  async function fetchData() {
    const [{ data: quizData }, { data: questionData }] = await Promise.all([
      supabase.from('quizzes').select('*').eq('id', quizId).single(),
      supabase.from('questions').select('*').eq('quiz_id', quizId).order('order_index'),
    ])
    setQuiz(quizData)
    setQuestions(questionData || [])
    setLoading(false)
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
    if (error) {
      showFeedback('error', 'Feil ved lagring: ' + error.message)
    } else {
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
    if (error) {
      showFeedback('error', 'Feil ved oppdatering: ' + error.message)
    } else {
      showFeedback('success', 'Spørsmål oppdatert!')
      setEditingId(null)
      fetchData()
    }
    setSaving(false)
  }

  async function deleteQuestion(id: string) {
    if (!confirm('Slett dette spørsmålet?')) return
    const { error } = await supabase.from('questions').delete().eq('id', id)
    if (error) {
      showFeedback('error', 'Kunne ikke slette: ' + error.message)
    } else {
      showFeedback('success', 'Spørsmål slettet.')
      fetchData()
    }
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
      <div className="bg-gray-900 border border-yellow-400/30 rounded-2xl p-5 mb-4">
        <h3 className="text-white font-bold mb-4">{label}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-gray-400 text-xs font-semibold mb-1 block">Spørsmål *</label>
            <textarea value={form.question_text} onChange={e => upd('question_text', e.target.value)}
              placeholder="Skriv spørsmålet her..." rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 resize-none text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {options.map(opt => {
              const key = opt === 'A' ? 'option_a' : opt === 'B' ? 'option_b' : opt === 'C' ? 'option_c' : 'option_d'
              return (
                <div key={opt}>
                  <label className="text-gray-400 text-xs font-semibold mb-1 flex items-center gap-1">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-black ${form.correct_answer === opt ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-300'}`}>{opt}</span>
                    {form.correct_answer === opt && <span className="text-green-400 text-xs">riktig</span>}
                  </label>
                  <input type="text" value={(form as any)[key]} onChange={e => upd(key, e.target.value)}
                    placeholder={`Alternativ ${opt}`}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 text-sm" />
                </div>
              )
            })}
          </div>
          <div>
            <label className="text-gray-400 text-xs font-semibold mb-1 block">Riktig svar</label>
            <div className="flex gap-2">
              {options.map(opt => (
                <button key={opt} onClick={() => upd('correct_answer', opt)}
                  className={`flex-1 py-1.5 rounded-xl text-sm font-bold transition-all ${form.correct_answer === opt ? 'bg-green-500 text-white' : 'bg-gray-800 text-white'}`}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-400 text-xs font-semibold mb-1 block">Forklaring (valgfritt)</label>
              <input type="text" value={form.explanation} onChange={e => upd('explanation', e.target.value)}
                placeholder="Kort forklaring..."
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 text-sm" />
            </div>
            <div>
              <label className="text-gray-400 text-xs font-semibold mb-1 block">Egendefinert tid (sek)</label>
              <input type="number" value={form.time_limit_seconds} onChange={e => upd('time_limit_seconds', e.target.value)}
                placeholder={`Standard: ${quiz?.time_limit_seconds}s`}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onSave} disabled={saving}
              className="flex-1 bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-950 font-black py-2 rounded-xl text-sm transition-all">
              {saving ? 'Lagrer...' : 'Lagre'}
            </button>
            <button onClick={onCancel}
              className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2 rounded-xl text-sm transition-all">
              Avbryt
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-white animate-pulse">Laster...</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/admin/quizzes" className="text-gray-400 hover:text-white text-sm mb-2 inline-block">← Tilbake</Link>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-black text-white">{quiz?.title}</h1>
            <p className="text-gray-400 text-sm">{questions.length} spørsmål · {numOptions} alternativer</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/quiz/${quizId}`} target="_blank"
              className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-xl text-sm transition-all">
              Forhåndsvis
            </Link>
            <button onClick={() => { setShowForm(!showForm); setEditingId(null) }}
              className="bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black px-4 py-1.5 rounded-xl text-sm transition-all">
              {showForm ? '✕ Avbryt' : '+ Nytt spørsmål'}
            </button>
          </div>
        </div>

        {feedback && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-semibold ${feedback.type === 'success' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
          </div>
        )}

        {showForm && renderForm(newQ, setNewQ, saveQuestion, () => setShowForm(false), 'Nytt spørsmål')}

        {questions.length === 0 && !showForm ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center border border-gray-800">
            <p className="text-gray-400 mb-4">Ingen spørsmål ennå.</p>
            <button onClick={() => setShowForm(true)}
              className="bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black px-6 py-2 rounded-xl">
              + Nytt spørsmål
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {questions.map((q, idx) => (
              <div key={q.id}>
                {editingId === q.id ? (
                  renderForm(editForm, setEditForm, saveEdit, () => setEditingId(null), `Rediger spørsmål ${idx + 1}`)
                ) : (
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button onClick={() => moveQuestion(q.id, 'up')} disabled={idx === 0}
                          className="text-gray-600 hover:text-white disabled:opacity-20 text-xs leading-none py-0.5">▲</button>
                        <span className="text-gray-600 text-xs text-center leading-none">{idx + 1}</span>
                        <button onClick={() => moveQuestion(q.id, 'down')} disabled={idx === questions.length - 1}
                          className="text-gray-600 hover:text-white disabled:opacity-20 text-xs leading-none py-0.5">▼</button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-semibold mb-2 leading-snug">{q.question_text}</p>
                        <div className="grid grid-cols-2 gap-1">
                          {options.map(opt => {
                            const val = q[optionKeys[opt]] as string
                            if (!val) return null
                            const isCorrect = q.correct_answer === opt
                            return (
                              <p key={opt} className={`text-xs px-2 py-1 rounded-lg ${isCorrect ? 'bg-green-900/60 text-green-300' : 'bg-gray-800 text-gray-400'}`}>
                                <span className="font-bold">{opt}:</span> {val}{isCorrect && ' ✓'}
                              </p>
                            )
                          })}
                        </div>
                        {q.explanation && <p className="text-gray-500 text-xs mt-2">💡 {q.explanation}</p>}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => startEdit(q)}
                          className="text-blue-400 hover:text-blue-200 text-xs px-2 py-1 bg-blue-900/30 rounded-lg transition-all">
                          Rediger
                        </button>
                        <button onClick={() => deleteQuestion(q.id)}
                          className="text-red-400 hover:text-red-200 text-xs px-2 py-1 bg-red-900/30 rounded-lg transition-all">
                          Slett
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {questions.length > 0 && (
          <div className="mt-6 flex gap-3 justify-end">
            <Link href={`/admin/quizzes/${quizId}/analytics`}
              className="bg-gray-800 hover:bg-gray-700 text-white font-semibold px-5 py-2 rounded-xl text-sm inline-block transition-all">
              Se analytics →
            </Link>
            <Link href="/admin/quizzes"
              className="bg-green-600 hover:bg-green-500 text-white font-black px-6 py-2 rounded-xl inline-block transition-all text-sm">
              ✅ Ferdig
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}