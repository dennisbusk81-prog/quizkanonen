'use client'
import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

const NAME_RE = /^[\p{L}\s\-']{2,40}$/u

function isValidName(name: string | null | undefined): boolean {
  if (!name) return false
  const trimmed = name.trim()
  if (!NAME_RE.test(trimmed)) return false
  return trimmed.includes(' ') || trimmed.includes('-')
}

// Henter session med timeout slik at auth-lock-konflikt ikke henger evig.
// 1500ms holder rikelig: getSession() leser normalt cookie/localStorage på
// <100ms — verdien er kun en sikkerhetsventil mot lock-konflikt, ikke normal last.
async function getSessionWithTimeout(ms = 1500) {
  return Promise.race([
    supabase.auth.getSession(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

async function checkAndFixDisplayName(user: User) {
  try {
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
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        // Sesjon ikke klar ennå — vis modal som fallback så bruker ikke sitter fast
        window.dispatchEvent(new CustomEvent('qk:name-required'))
        return
      }

      const res = await fetch('/api/profile/upsert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          id: user.id,
          display_name: candidateName,
        }),
      })
      if (res.ok) {
        // Gi beskjed til eventuelle åpne profilsider om å laste på nytt
        window.dispatchEvent(new CustomEvent('qk:profile-updated', { detail: { display_name: candidateName } }))
        return
      }
      // Upsert feilet (nettverksfeil, validering e.l.) — fall gjennom til modal
    }

    // Ingen gyldig Google-navn, eller upsert feilet — vis modal
    window.dispatchEvent(new CustomEvent('qk:name-required'))
  } catch {
    // Uventet feil (nettverksfeil, kast fra fetch, etc.) — vis modal så bruker
    // ikke sitter fast i "Laster profil..."-tilstand uten forklaring
    window.dispatchEvent(new CustomEvent('qk:name-required'))
  }
}

export default function AuthListener() {
  // Dedupe-vakt: getSession-stien OG onAuthStateChange(INITIAL_SESSION) fyrer
  // begge ved innlogging. Vi beholder begge som robusthetsnett, men kjører
  // checkAndFixDisplayName kun ÉN gang per bruker — den stien som fyrer først vinner.
  // En ny bruker-id (logg ut → logg inn som annen) tillates å kjøre på nytt.
  const handledUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    const runOnce = (user: User) => {
      if (handledUserIdRef.current === user.id) return
      handledUserIdRef.current = user.id
      checkAndFixDisplayName(user)
    }

    // Primary: getSession() med timeout — omgår heng fra auth-lock-konflikt
    getSessionWithTimeout().then((result) => {
      if (!result) return  // timeout
      const session = result.data?.session
      if (session?.user) runOnce(session.user)
    })

    // Backup: onAuthStateChange for innlogging og tilfeller der
    // getSession() henger men INITIAL_SESSION fyrer via event-cache
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if ((event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') || !session?.user) return
        runOnce(session.user)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return null
}
