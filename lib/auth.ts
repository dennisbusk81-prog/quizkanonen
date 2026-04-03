import { supabase } from './supabase'
import type { Profile } from './supabase'
import type { Session } from '@supabase/supabase-js'

export async function signInWithGoogle(next?: string): Promise<void> {
  const redirectTo = next
    ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
    : `${window.location.origin}/auth/callback`
  console.error('[signInWithGoogle] redirectTo:', redirectTo)
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  console.error('[signInWithGoogle] data:', data)
  console.error('[signInWithGoogle] error:', error)
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return data
}
