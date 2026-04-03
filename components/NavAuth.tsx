'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default function NavAuth() {
  const [sessionResolved, setSessionResolved] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        setLoggedIn(!!session)
        setSessionResolved(true)
      } else {
        setLoggedIn(!!session)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  if (!sessionResolved) return null
  if (loggedIn) return null

  return (
    <Link href="/login" className="qk-nav-login">Logg inn gratis</Link>
  )
}
