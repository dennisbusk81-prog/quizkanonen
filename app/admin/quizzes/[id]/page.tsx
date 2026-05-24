'use client'
import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// Redirect legacy /admin/quizzes/[id] to the unified editor
export default function QuizCockpitRedirect() {
  const params = useParams()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/admin/quizzes/new?id=${params.id}`)
  }, [params.id, router])
  return (
    <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#e8e4dd', fontFamily: "'Instrument Sans', sans-serif" }}>Laster...</p>
    </div>
  )
}
