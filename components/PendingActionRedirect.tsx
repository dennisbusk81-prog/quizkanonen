'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

export default function PendingActionRedirect() {
  const router = useRouter()

  useEffect(() => {
    if (localStorage.getItem('qk_pending_action') !== 'founders_checkout') return

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )

    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      localStorage.removeItem('qk_pending_action')
      router.push('/founders')
    })
  }, [router])

  return null
}
