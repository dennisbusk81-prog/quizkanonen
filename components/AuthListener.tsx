'use client'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const NAME_RE = /^[\p{L}\s\-']{2,40}$/u

function isValidName(name: string | null | undefined): boolean {
  return !!name && NAME_RE.test(name.trim())
}

export default function AuthListener() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event !== 'SIGNED_IN' || !session?.user) return

        const user = session.user

        // Fetch existing profile to check display_name
        const { data: existing } = await supabase
          .from('profiles')
          .select('id, display_name')
          .eq('id', user.id)
          .maybeSingle()

        let currentName: string | null = existing?.display_name ?? null

        // If profile exists and name is valid, nothing to do
        if (existing && isValidName(currentName)) return

        // Try to auto-set from Google full_name
        const fullName = user.user_metadata?.full_name as string | undefined
        const candidateName = isValidName(fullName ?? null)
          ? (fullName ?? null)
          : (!existing ? (user.email?.split('@')[0] ?? null) : null)

        if (candidateName) {
          await fetch('/api/profile/upsert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: user.id,
              display_name: candidateName,
              avatar_color: null,
            }),
          })
          currentName = candidateName
        } else if (!existing) {
          // New profile, no usable name — upsert with null handled by backend
          console.log('[AuthListener] No full_name available for new user, will prompt for name')
        }

        // If name is still invalid, show the name-required modal
        if (!isValidName(currentName)) {
          window.dispatchEvent(new CustomEvent('qk:name-required'))
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return null
}
