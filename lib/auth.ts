import { supabase } from './supabase'
import type { Profile } from './supabase'
import type { Session } from '@supabase/supabase-js'

export async function signInWithGoogle(next?: string): Promise<void> {
  const redirectTo = next
    ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
    : `${window.location.origin}/auth/callback`
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
}

export async function signInWithPassword(email: string, password: string) {
  // Speiler signInWithGoogle sin struktur, men returnerer Supabase-responsen
  // ({ data, error }) slik at innloggingssiden kan vise feil (feil passord,
  // ikke bekreftet e-post osv.). Ingen redirect her — kalleren styrer navigasjon.
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signUpWithPassword(email: string, password: string, next?: string) {
  // emailRedirectTo bygges likt som i signInWithGoogle. Med "Confirm email" PÅ i
  // Supabase sendes en bekreftelseslenke hit; profilraden opprettes i /auth/callback
  // når brukeren klikker den (samme sti som Google/magic link).
  const emailRedirectTo = next
    ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
    : `${window.location.origin}/auth/callback`
  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  })
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
  window.location.href = '/'
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
