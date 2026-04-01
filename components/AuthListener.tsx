'use client'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function AuthListener() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event !== 'SIGNED_IN' || !session?.user) return

        const user = session.user

        // Check if profile already exists before calling the API
        const { data: existing } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle()

        if (existing) return

        // Profile missing — ask the server to upsert it via service role
        await fetch('/api/profile/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: user.id,
            display_name:
              (user.user_metadata?.full_name as string | undefined) ??
              user.email?.split('@')[0] ??
              null,
            avatar_color: null,
          }),
        })
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return null
}
