'use client'

import { useEffect, use } from 'react'
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

  useEffect(() => {
    let cancelled = false

    async function checkPlayed() {
      const { data: { session } } = await supabase.auth.getSession()
      // Anonym bruker: ingen sjekk, quiz vises normalt
      if (!session?.access_token) return

      try {
        const res = await fetch(`/api/quiz/${quizId}/check-played`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const json = await res.json()
        if (!cancelled && json.played) {
          router.replace(`/leaderboard/${quizId}`)
        }
      } catch {
        // Ikke kritisk — vis quizen uansett
      }
    }

    checkPlayed()
    return () => { cancelled = true }
  }, [quizId, router])

  // Render alltid — redirect skjer som sideeffekt for innloggede som har spilt
  return <>{children}</>
}
