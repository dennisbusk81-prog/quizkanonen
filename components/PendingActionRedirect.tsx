'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { PENDING_ACTION_KEY } from '@/lib/pendingAction'

export default function PendingActionRedirect() {
  const router = useRouter()

  useEffect(() => {
    const pending = localStorage.getItem(PENDING_ACTION_KEY)
    if (!pending) return

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    if (pending === 'founders_checkout') {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) return
        localStorage.removeItem(PENDING_ACTION_KEY)
        router.push('/founders')
      })
    } else if (pending.startsWith('liga_join:')) {
      // Fallback for when the OAuth ?next= param was lost and the user
      // landed at home instead of the invite page after logging in.
      const inviteToken = pending.slice('liga_join:'.length)
      if (!inviteToken) return
      supabase.auth.getSession().then(({ data }) => {
        // NOTE: this client uses localStorage for auth (not cookies).
        // If the session was set via cookie-based auth/callback it will NOT be found here.
        if (!data.session) return
        localStorage.removeItem(PENDING_ACTION_KEY)
        router.push(`/liga/bli-med/${inviteToken}`)
      })
    } else if (pending.startsWith('org_join:')) {
      // Fallback for when the OAuth ?next= param was lost during org invite flow.
      const inviteToken = pending.slice('org_join:'.length)
      if (!inviteToken) return
      supabase.auth.getSession().then(({ data }) => {
        // NOTE: this client uses localStorage for auth (not cookies).
        // If the session was set via cookie-based auth/callback it will NOT be found here.
        if (!data.session) return
        localStorage.removeItem(PENDING_ACTION_KEY)
        router.push(`/bli-med/${inviteToken}`)
      })
    }
  }, [router])

  return null
}
