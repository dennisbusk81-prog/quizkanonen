import type { Session } from '@supabase/supabase-js'

// ── Stabil session-identitet for å unngå unødvendige re-fetch ved token-refresh ──
// Supabase sin klient fyrer onAuthStateChange (typisk TOKEN_REFRESHED) automatisk
// når fanen får fokus igjen, med et NYTT session-objekt selv om brukeren er den
// samme. Effekter/callbacks som reagerer på hele session-objektet re-kjører derfor
// unødvendig og nuller ut allerede lastet data ("flash"). Denne funksjonen gir en
// stabil verdi å sammenligne mot i stedet: uendret så lenge brukeren er den samme.
//
// Tre tilstander holdes bevisst atskilt (ikke kollapset til f.eks. null/string):
// enkelte sider bruker Session|null|undefined for session-state (undefined =
// ikke sjekket ennå, null = bekreftet ikke innlogget) — å slå disse sammen ville
// f.eks. ødelegge en login-redirect som er avhengig av å skille dem.
export type SessionIdentity = 'unchecked' | 'anon' | string

export function getSessionIdentity(session: Session | null | undefined): SessionIdentity {
  if (session === undefined) return 'unchecked'
  if (session === null) return 'anon'
  return session.user.id
}
