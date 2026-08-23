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

// `scope: 'local'` er IKKE en detalj — defaulten i auth-js er `'global'`
// (GoTrueClient.signOut), som sletter sesjonsRADEN for brukeren på ALLE
// enheter. Den som logget ut på PC-en, drepte samtidig mobilen sin.
//
// Det gir ikke en ren utlogging på mobilen, men en halv-innlogget tilstand:
// access-tokenet ligger fortsatt i localStorage, det er signert og ikke
// utløpt, så `getSession()` returnerer det og klienten tror den er innlogget.
// GoTrue slår derimot opp `session_id`-claimet i `sessions` og svarer
// `session_not_found` → `AuthSessionMissingError` (status 400). Alle ~69
// kallstedene som gjør `supabaseAdmin.auth.getUser(token)` avviser da
// brukeren, mens navnet hennes fortsatt står i menyen (PostgREST verifiserer
// kun signatur og `exp`, og bryr seg ikke om sesjonsraden).
//
// Verst i spillestien: `my-attempt` svarer `200 { played: false }` (replay-
// sperren er av). Fram til 24. august 2026 fortsatte det slik: `start-attempt`
// falt til gjeste-behandling og opprettet raden med `user_id: null` — 400 er
// ikke i `isTransientAuthStatus`, så 503-vakten griper ikke — og `submit`
// avviste til slutt med 403. Spilleren spilte hele quizen og fikk «Resultatet
// ble ikke lagret» ved MÅLSTREKEN. Ingenting lagret, ingen sesongpoeng.
//
// Den halvdelen er lukket: `start-attempt` krever nå en gyldig bruker og
// svarer `401 { needsLogin: true }`, og quiz-siden åpner innloggingspanelet
// på det svaret. Feilen kommer altså FØR første spørsmål, med en vei tilbake
// inn, i stedet for etter siste. Selve halv-innloggede tilstanden består —
// `my-attempt` (og de øvrige ~69 kallstedene) svarer fortsatt som om alt er
// i orden, og ingen rute logger den: kun `/api/org/my-orgs` har en
// `console.error` på auth-grenen.
//
// Ingen flate i appen tilbyr «logg ut overalt», så global var aldri et valgt
// produktkrav — den var bare defaulten. Trenger vi det senere, skal det være
// en egen, eksplisitt knapp.
export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' })
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
