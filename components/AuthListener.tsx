'use client'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

const NAME_RE = /^[\p{L}\s\-']{2,40}$/u

function isValidName(name: string | null | undefined): boolean {
  return !!name && NAME_RE.test(name.trim())
}

async function checkAndFixDisplayName(user: User) {
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id', user.id)
    .maybeSingle()

  let currentName: string | null = existing?.display_name ?? null

  // If profile exists and name is valid, nothing to do
  if (existing && isValidName(currentName)) return

  // Try Google name fields in priority order — never fall back to email prefix
  const googleName = (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined
  const candidateName = isValidName(googleName ?? null) ? (googleName as string) : null

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
  }

  // If name is still invalid or missing, show the name-required modal
  if (!isValidName(currentName)) {
    window.dispatchEvent(new CustomEvent('qk:name-required'))
  }
}

export default function AuthListener() {
  useEffect(() => {
    // Primary: getSession() direkte ved mount — fanger opp allerede innloggede
    // brukere uten å vente på onAuthStateChange (som kan henge pga. lock)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) checkAndFixDisplayName(session.user)
    })

    // Backup: onAuthStateChange for innlogging og tilfeller der
    // getSession() henger men INITIAL_SESSION fyrer
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if ((event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') || !session?.user) return
        checkAndFixDisplayName(session.user)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return null
}
