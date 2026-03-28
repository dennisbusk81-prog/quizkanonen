'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { supabase, Quiz, Question } from '@/lib/supabase'
import Link from 'next/link'

type NewQuestion = {
  question_text: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_answer: string
  explanation: string
  time_limit_seconds: string
}

const emptyQuestion = (): NewQuestion => ({
  question_text: '', option_a: '', option_b: '', option_c: '', option_d: '',
  correct_answer: 'A', explanation: '', time_limit_seconds: ''
})

export default function QuizQuestions() {
  const params = useParams()
  const router = useRouter()
  const quizId = params.id as string

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [newQ, setNewQ] = useState<NewQuestion>(emptyQuestion())
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

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

  const updateQ = (key: string, value: string) => setNewQ(q => ({ ...q, [key]: value }))

  async function saveQuestion() {
    if (!newQ.question_text || !newQ.option_a || !newQ.option_b) {
      alert('Fyll inn spørsmål og minst to svaralternativer.')
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
    if (error) { alert('Feil: ' + error.message); setSaving(false); return }
    setNewQ(emptyQuestion())
    setShowForm(false)
    fetchData()
    setSaving(false)
  }

  async function deleteQuestion(id: string) {
    if (!confirm('Slett dette spørsmålet?')) return
    await supabase.from('questions').delete().eq('id', id)
    fetchData()
  }

  async function moveQuestion(id: string, direction: 'up' | 'down') {
    const idx = questions.findIndex(q => q.id === id)
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === questions.length - 1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const updates = [
      { id: questions[idx].id, order_index: questions[swapIdx].order_index },
      { id: questions[swapIdx].id, order_index: questions[idx].order_index },
    ]
    for (const u of updates) {
      await supabase.from('questions').update({ order_index: u.order_index }).eq('id', u.id)
    }
    fetchData()
  }

  const optionLabel: Record<string, string> = { A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d' }
  const numOptions = quiz?.num_options || 4
  const options = ['A', 'B', 'C', 'D'].slice(0, numOptions)

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-white animate-pulse">Laster...</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/admin/quizzes" className="text-gray-400 hover:text-white text-sm mb-2 inline-block">← Tilbake til quizer</Link>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black text-white">{quiz?.title}</h1>
            <p className="text-gray-400 text-sm">{questions.length} spørsmål · {numOptions} svaralternativer</p>
          </div>
          <button onClick={() => setShowForm(!showForm)}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black px-4 py-2 rounded-xl transition-all">
            {showForm ? '✕ Avbryt' : '+ Nytt spørsmål'}
          </button>
        </div>

        {/* Skjema for nytt spørsmål */}
        {showForm && (
          <div className="bg-gray-900 border border-yellow-400/30 rounded-2xl p-6 mb-6">
            <h2 className="text-white font-bold mb-4">Nytt spørsmål</h2>
            <div className="space-y-4">
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">Spørsmål *</label>
                <textarea value={newQ.question_text} onChange={e => updateQ('question_text', e.target.value)}
                  placeholder="Skriv spørsmålet her..."
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {options.map(opt => (
                  <div key={opt}>
                    <label className="text-gray-300 text-sm font-semibold mb-1 block flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${newQ.correct_answer === opt ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-300'}`}>
                        {opt}
                      </span>
                      {newQ.correct_answer === opt && <span className="text-green-400 text-xs">✓ Riktig</span>}
                    </label>
                    <input type="text"
                      value={(newQ as any)[optionLabel[opt]]}
                      onChange={e => updateQ(optionLabel[opt], e.target.value)}
                      placeholder={`Svaralternativ ${opt}`}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 text-sm" />
                  </div>
                ))}
              </div>

              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">Hvilket svar er riktig?</label>
                <div className="flex gap-2">
                  {options.map(opt => (
                    <button key={opt} onClick={() => updateQ('correct_answer', opt)}
                      className={`flex-1 py-2 rounded-xl font-bold transition-all text-sm ${newQ.correct_answer === opt ? 'bg-green-500 text-white' : 'bg-gray-800 text-white'}`}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">Forklaring (valgfritt)</label>
                <input type="text" value={newQ.explanation} onChange={e => updateQ('explanation', e.target.value)}
                  placeholder="Kort forklaring vist etter svar..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 text-sm" />
              </div>

              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">
                  Egendefinert tid (sekunder) — blank = bruker quiz-standard ({quiz?.time_limit_seconds}s)
                </label>
                <input type="number" value={newQ.time_limit_seconds} onChange={e => updateQ('time_limit_seconds', e.target.value)}
                  placeholder={`Standard: ${quiz?.time_limit_seconds}s`}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 text-sm" />
              </div>

              <button onClick={saveQuestion} disabled={saving}
                className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-950 font-black py-3 rounded-xl transition-all">
                {saving ? 'Lagrer...' : 'Lagre spørsmål'}
              </button>
            </div>
          </div>
        )}

        {/* Spørsmålsliste */}
        {questions.length === 0 ? (
          <div className="bg-gray-900 rounded-2xl p-8 text-center border border-gray-800">
            <p className="text-gray-400 mb-4">Ingen spørsmål ennå. Legg til ditt første!</p>
            <button onClick={() => setShowForm(true)}
              className="bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black px-6 py-3 rounded-xl">
              + Nytt spørsmål
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((q, idx) => (
              <div key={q.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-1">
                    <button onClick={() => moveQuestion(q.id, 'up')} disabled={idx === 0}
                      className="text-gray-600 hover:text-white disabled:opacity-20 text-sm">▲</button>
                    <span className="text-gray-500 text-xs text-center">{idx + 1}</span>
                    <button onClick={() => moveQuestion(q.id, 'down')} disabled={idx === questions.length - 1}
                      className="text-gray-600 hover:text-white disabled:opacity-20 text-sm">▼</button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm mb-2">{q.question_text}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {['A', 'B', 'C', 'D'].slice(0, numOptions).map(opt => {
                        const val = q[optionLabel[opt] as keyof Question] as string
                        if (!val) return null
                        const isCorrect = q.correct_answer === opt
                        return (
                          <p key={opt} className={`text-xs px-2 py-1 rounded-lg ${isCorrect ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'}`}>
                            <span className="font-bold">{opt}:</span> {val}
                            {isCorrect && ' ✓'}
                          </p>
                        )
                      })}
                    </div>
                    {q.explanation && (
                      <p className="text-gray-500 text-xs mt-2">💡 {q.explanation}</p>
                    )}
                  </div>
                  <button onClick={() => deleteQuestion(q.id)}
                    className="text-red-800 hover:text-red-400 transition-colors text-sm flex-shrink-0">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {questions.length > 0 && (
          <div className="mt-6 text-center">
            <Link href="/admin/quizzes"
              className="bg-green-600 hover:bg-green-500 text-white font-black px-8 py-3 rounded-xl inline-block transition-all">
              ✅ Ferdig — tilbake til quizer
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}