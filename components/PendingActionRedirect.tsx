'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

export default function PendingActionRedirect() {
  const router = useRouter()

  useEffect(() => {
    const pending = localStorage.getItem('qk_pending_action')
    console.log('[PendingActionRedirect] pending action:', pending)
    if (!pending) return

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    if (pending === 'founders_checkout') {
      supabase.auth.getSession().then(({ data }) => {
        console.log('[PendingActionRedirect] founders_checkout — session:', !!data.session)
        if (!data.session) return
        localStorage.removeItem('qk_pending_action')
        router.push('/founders')
      })
    } else if (pending.startsWith('liga_join:')) {
      // Fallback for when the OAuth ?next= param was lost and the user
      // landed at home instead of the invite page after logging in.
      const inviteToken = pending.slice('liga_join:'.length)
      console.log('[PendingActionRedirect] liga_join — inviteToken:', inviteToken)
      if (!inviteToken) {
        console.warn('[PendingActionRedirect] inviteToken is empty — aborting')
        return
      }
      supabase.auth.getSession().then(({ data }) => {
        // NOTE: this client uses localStorage for auth (not cookies).
        // If the session was set via cookie-based auth/callback it will NOT be found here.
        console.log('[PendingActionRedirect] liga_join getSession result — session:', !!data.session, '— client type: plain createClient (localStorage-based)')
        if (!data.session) {
          console.warn('[PendingActionRedirect] no session found — redirect aborted. This is expected if auth/callback set a cookie-based session and this client only reads localStorage.')
          return
        }
        localStorage.removeItem('qk_pending_action')
        router.push(`/liga/bli-med/${inviteToken}`)
      })
    }
  }, [router])

  return null
}
