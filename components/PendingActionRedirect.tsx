'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

export default function PendingActionRedirect() {
  const router = useRouter()

  useEffect(() => {
    const pending = localStorage.getItem('qk_pending_action')
    if (!pending) return

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    if (pending === 'founders_checkout') {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) return
        localStorage.removeItem('qk_pending_action')
        router.push('/founders')
      })
    } else if (pending.startsWith('liga_join:')) {
      // Fallback for when the OAuth ?next= param was lost and the user
      // landed at home instead of the invite page after logging in.
      const inviteToken = pending.slice('liga_join:'.length)
      if (!inviteToken) return
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) return
        localStorage.removeItem('qk_pending_action')
        router.push(`/liga/bli-med/${inviteToken}`)
      })
    }
  }, [router])

  return null
}
