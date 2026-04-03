'use client'

import { supabase } from '@/lib/supabase'

interface Props {
  className?: string
  children: React.ReactNode
}

export default function GoogleSignInButton({ className, children }: Props) {
  async function handleClick() {
    const redirectTo = `${window.location.origin}/auth/callback`
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    })
    if (error || !data?.url) {
      console.error('Google OAuth error:', error)
      return
    }
    window.location.href = data.url
  }

  return (
    <button type="button" className={className} onClick={handleClick}>
      {children}
    </button>
  )
}
