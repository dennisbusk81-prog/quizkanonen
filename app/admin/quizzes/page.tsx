'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { supabase, Quiz } from '@/lib/supabase'
import Link from 'next/link'

export default function AdminQuizzes() {
    const router = useRouter()
    const [quizzes, setQuizzes] = useState<Quiz[]>([])
    const [loading, setLoading] = useState(true)
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

    useEffect(() => {
        if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
        fetchQuizzes()
    }, [])

    function showFeedback(type: 'success' | 'error', msg: string) {
        setFeedback({ type, msg })
        setTimeout(() => setFeedback(null), 3000)
    }

    async function fetchQuizzes() {
        const { data } = await supabase
            .from('quizzes').select('*').order('created_at', { ascending: false })
        setQuizzes(data || [])
        setLoading(false)
    }

    async function toggleActive(quiz: Quiz) {
        await supabase.from('quizzes').update({ is_active: !quiz.is_active }).eq('id', quiz.id)
        fetchQuizzes()
    }

    async function deleteQuiz(id: string) {
        if (!confirm('Er du sikker på at du vil slette denne quizen? Dette kan ikke angres.')) return
        await supabase.from('quizzes').delete().eq('id', id)
        fetchQuizzes()
    }

    async function resetQuiz(id: string, title: string) {
        if (!confirm(`Nullstill "${title}"? Dette sletter alle resultater og lar alle spille på nytt.`)) return

        const { data: attempts } = await supabase
            .from('attempts').select('id').eq('quiz_id', id)

        if (attempts && attempts.length > 0) {
            const attemptIds = attempts.map((a: { id: string }) => a.id)
            await supabase.from('attempt_answers').delete().in('attempt_id', attemptIds)
            await supabase.from('attempts').delete().eq('quiz_id', id)
        }

        await supabase.from('played_log').delete().eq('quiz_id', id)

        showFeedback('success', `"${title}" er nullstilt — alle kan spille igjen.`)
        fetchQuizzes()
    }

    const isOpen = (quiz: Quiz) => {
        const now = new Date()
        return new Date(quiz.opens_at) <= now && new Date(quiz.closes_at) >= now
    }

    const formatDate = (d: string) => new Date(d).toLocaleString('no-NO', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })

    if (loading) return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center">
            <p className="text-white animate-pulse">Laster quizer...</p>
        </div>
    )

    return (
        <main className="min-h-screen bg-gray-950 px-4 py-8">
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <Link href="/admin" className="text-gray-400 hover:text-white text-sm mb-2 inline-block">← Admin</Link>
                        <h1 className="text-2xl font-black text-white">📋 Alle quizer</h1>
                    </div>
                    <Link href="/admin/quizzes/new"
                        className="bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black px-5 py-2 rounded-xl transition-all">
                        + Ny quiz
                    </Link>
                </div>

                {feedback && (
                    <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-semibold ${feedback.type === 'success' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
                        {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
                    </div>
                )}

                {quizzes.length === 0 ? (
                    <div className="bg-gray-900 rounded-2xl p-8 text-center border border-gray-800">
                        <p className="text-gray-400 text-xl mb-4">Ingen quizer ennå.</p>
                        <Link href="/admin/quizzes/new"
                            className="bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black px-6 py-3 rounded-xl inline-block">
                            Lag din første quiz
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {quizzes.map(quiz => (
                            <div key={quiz.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <h2 className="text-white font-bold text-lg">{quiz.title}</h2>
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${!quiz.is_active ? 'bg-gray-700 text-gray-300' :
                                                    isOpen(quiz) ? 'bg-green-900 text-green-300' : 'bg-blue-900 text-blue-300'
                                                }`}>
                                                {!quiz.is_active ? 'Skjult' : isOpen(quiz) ? '🟢 Åpen' : '🔵 Stengt'}
                                            </span>
                                        </div>
                                        <p className="text-gray-400 text-sm">{quiz.description}</p>
                                        <div className="flex gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                                            <span>📅 Åpner: {formatDate(quiz.opens_at)}</span>
                                            <span>🔒 Stenger: {formatDate(quiz.closes_at)}</span>
                                            <span>⏱️ {quiz.time_limit_seconds}s per spørsmål</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                                        <Link href={`/admin/quizzes/${quiz.id}/questions`}
                                            className="bg-blue-900 hover:bg-blue-800 text-blue-200 px-3 py-1.5 rounded-lg text-sm transition-all">
                                            Spørsmål
                                        </Link>
                                        <Link
                                            href={`/admin/quizzes/${quiz.id}/questions`}
                                            className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg text-sm transition-all"
                                        >
                                            Rediger
                                        </Link>
                                        <button onClick={() => toggleActive(quiz)}
                                            className={`px-3 py-1.5 rounded-lg text-sm transition-all ${quiz.is_active
                                                    ? 'bg-orange-900 hover:bg-orange-800 text-orange-200'
                                                    : 'bg-green-900 hover:bg-green-800 text-green-200'
                                                }`}>
                                            {quiz.is_active ? 'Skjul' : 'Publiser'}
                                        </button>
                                        <button onClick={() => resetQuiz(quiz.id, quiz.title)}
                                            className="bg-purple-900 hover:bg-purple-800 text-purple-200 px-3 py-1.5 rounded-lg text-sm transition-all">
                                            Reset
                                        </button>
                                        <button onClick={() => deleteQuiz(quiz.id)}
                                            className="bg-red-900 hover:bg-red-800 text-red-200 px-3 py-1.5 rounded-lg text-sm transition-all">
                                            Slett
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    )
}