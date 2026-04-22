'use client'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

const NAME_RE = /^[\p{L}\s\-']{2,40}$/u

function isValidName(name: string | null | undefined): boolean {
  return !!name && NAME_RE.test(name.trim())
}

// Henter session med timeout slik at auth-lock-konflikt ikke henger evig
async function getSessionWithTimeout(ms = 3000) {
  return Promise.race([
    supabase.auth.getSession(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

async function checkAndFixDisplayName(user: User) {
  // Hent eksisterende profil
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id', user.id)
    .maybeSingle()

  const currentName: string | null = existing?.display_name ?? null

  // Gyldig navn — ingenting å gjøre
  if (isValidName(currentName)) return

  // Forsøk å sette Google-navn automatisk
  const googleName = (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined
  const candidateName = isValidName(googleName ?? null) ? (googleName as string) : null

  if (candidateName) {
    // Sett Google-navn automatisk — én-gangs migrering for brukere med ugyldig navn
    await fetch('/api/profile/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: user.id,
        display_name: candidateName,
      }),
    })
    // Gi beskjed til eventuelle åpne profilsider om å laste på nytt
    window.dispatchEvent(new CustomEvent('qk:profile-updated', { detail: { display_name: candidateName } }))
    return
  }

  // Ingen gyldig Google-navn finnes — vis modal så bruker skriver inn selv
  window.dispatchEvent(new CustomEvent('qk:name-required'))
}

export default function AuthListener() {
  useEffect(() => {
    // Primary: getSession() med timeout — omgår heng fra auth-lock-konflikt
    getSessionWithTimeout(3000).then((result) => {
      if (!result) return  // timeout
      const session = result.data?.session
      if (session?.user) checkAndFixDisplayName(session.user)
    })

    // Backup: onAuthStateChange for innlogging og tilfeller der
    // getSession() henger men INITIAL_SESSION fyrer via event-cache
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
