'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function QuizLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id: quizId } = use(params)
  const router = useRouter()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function checkPlayed() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        if (!cancelled) setChecked(true)
        return
      }

      try {
        const res = await fetch(`/api/quiz/${quizId}/check-played`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const json = await res.json()
        if (cancelled) return
        if (json.played) {
          router.replace(`/leaderboard/${quizId}`)
          return
        }
      } catch {
        // Ikke kritisk — vis quizen uansett
      }

      if (!cancelled) setChecked(true)
    }

    checkPlayed()
    return () => { cancelled = true }
  }, [quizId, router])

  if (!checked) return null

  return <>{children}</>
}
