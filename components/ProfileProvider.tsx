'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { fetchPremiumStatusFull, hydratePremiumStatus } from '@/lib/premium-status'

// Én organisasjon brukeren er medlem av. Samme form som /api/org/my-orgs
// returnerer, slik at konsumenter kan bruke context-verdien direkte.
export interface MyOrg {
  orgId: string
  orgName: string
  orgSlug: string
  isAdmin: boolean
  subscriptionStatus: string
  allowGlobalLeague: boolean
  // null = ikke besvart, true = valgt seg ut, false = valgt seg inn
  globalLeagueOptOut: boolean | null
}

interface ProfileContextValue {
  userId: string | null
  displayName: string | null
  isPremium: boolean
  hasStripeCustomer: boolean
  premiumSource: string | null
  myOrgs: MyOrg[]
  // true når profildata (premium/orgs) fortsatt hentes.
  loading: boolean
  // true straks innlogget/utlogget-status er avgjort (første auth-event eller
  // timeout) — uavhengig av om profildata er ferdig hentet. Brukes av chrome
  // (NavAuth/UserMenu) til å unngå å flashe feil innloggingstilstand.
  resolved: boolean
  // Tvinger en fersk server-sjekk av premium-status og oppdaterer context.
  // Null-safe: nedgraderer ALDRI på transient feil (behold forrige verdi).
  // Dette er ruten for de bevisste resjekkene (quiz-start, quiz-innsending,
  // leaderboard fane-fokus) — samme oppførsel som deres tidligere egne kall.
  refreshProfile: () => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used within a ProfileProvider')
  return ctx
}

export default function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [isPremium, setIsPremium] = useState<boolean>(false)
  const [hasStripeCustomer, setHasStripeCustomer] = useState<boolean>(false)
  const [premiumSource, setPremiumSource] = useState<string | null>(null)
  const [myOrgs, setMyOrgs] = useState<MyOrg[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [resolved, setResolved] = useState<boolean>(false)

  // Dedupe-vakt (samme mønster som AuthListener.tsx): kun første event per
  // bruker-id utløser full henting. TOKEN_REFRESHED/USER_UPDATED bærer samme
  // user.id → hoppes over, så de fyrer aldri unødvendige re-fetches. Dette er
  // hele poenget: ett konsolidert kall i stedet for 5–14.
  const handledUserIdRef = useRef<string | null>(null)

  // Full henting for en gitt sesjon: display_name + premium + myOrgs parallelt.
  const loadAll = useCallback(async (session: Session) => {
    const user = session.user
    const token = session.access_token
    setLoading(true)
    try {
      const [profileRes, premium, orgsJson] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
        fetchPremiumStatusFull(token, user.id),
        fetch('/api/org/my-orgs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: token }),
        })
          .then(r => (r.ok ? r.json() : { orgs: [] }))
          .catch(() => ({ orgs: [] })),
      ])

      setDisplayName(profileRes.data?.display_name ?? user.email?.split('@')[0] ?? null)
      // Kun definitivt svar endrer premium — aldri nedgrader på null (feil).
      if (premium !== null) {
        setIsPremium(premium.isPremium)
        setHasStripeCustomer(premium.hasStripeCustomer)
        setPremiumSource(premium.premiumSource)
      }
      setMyOrgs(orgsJson?.orgs ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  // Tvungen fersk premium-sjekk. Speiler nøyaktig de tidligere bevisste
  // resjekkene: ett premium-kall, null-safe, nedgraderer aldri. Henter IKKE
  // myOrgs på nytt (fane-fokus-resjekken skal ikke koste et ekstra org-kall).
  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token || !session.user) return
    const premium = await fetchPremiumStatusFull(session.access_token, session.user.id)
    if (premium !== null) {
      setIsPremium(premium.isPremium)
      setHasStripeCustomer(premium.hasStripeCustomer)
      setPremiumSource(premium.premiumSource)
    }
  }, [])

  useEffect(() => {
    // Sikkerhetsventil: fjern loading/oppløs etter 3s om INITIAL_SESSION aldri fyrer.
    const timeout = setTimeout(() => { setLoading(false); setResolved(true) }, 3000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        clearTimeout(timeout)
        handledUserIdRef.current = null
        setUserId(null)
        setDisplayName(null)
        setIsPremium(false)
        setHasStripeCustomer(false)
        setPremiumSource(null)
        setMyOrgs([])
        setLoading(false)
        setResolved(true)
        return
      }

      const user = session?.user
      if (!user) {
        // INITIAL_SESSION uten sesjon → utlogget, ferdig oppløst.
        if (event === 'INITIAL_SESSION') { clearTimeout(timeout); setLoading(false); setResolved(true) }
        return
      }

      // Reflekter alltid gjeldende bruker, også når hentingen dedupes bort.
      setUserId(user.id)
      setResolved(true)

      // Mot flash: hydrer en tidligere bekreftet premium fra sessionStorage
      // umiddelbart (kun oppgradering til true), før nettverkssvaret foreligger.
      // INITIAL_SESSION fyrer på <100ms, så en returnerende premium-bruker ser
      // aldri «ikke-premium» blinke før loadAll bekrefter.
      if (hydratePremiumStatus(user.id)) setIsPremium(true)

      // Dedupe: samme bruker allerede håndtert (tidligere event) → ingen
      // re-fetch. Dette er nøkkelen mot TOKEN_REFRESHED-støy.
      if (handledUserIdRef.current === user.id) {
        clearTimeout(timeout)
        setLoading(false)
        return
      }

      handledUserIdRef.current = user.id
      clearTimeout(timeout)
      loadAll(session)
    })

    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [loadAll])

  return (
    <ProfileContext.Provider
      value={{ userId, displayName, isPremium, hasStripeCustomer, premiumSource, myOrgs, loading, resolved, refreshProfile }}
    >
      {children}
    </ProfileContext.Provider>
  )
}
