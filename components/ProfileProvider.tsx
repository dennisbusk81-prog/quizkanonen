'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { fetchPremiumStatusFull, hydratePremiumStatus } from '@/lib/premium-status'
import { type Loaded } from '@/lib/fetch-result'
import { fetchMyOrgsResult } from '@/lib/my-orgs-fetch'

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
  // true KUN når /api/org/my-orgs faktisk har svart OK, altså når `myOrgs` er
  // et BEKREFTET svar på «hvilke bedrifter er denne brukeren medlem av».
  //
  // Dette er bevisst IKKE utledet av `loading`. `loading` settes til false fem
  // steder under, og bare ett av dem (finally i loadAll) innebærer at listen
  // har landet — dedupe-grenen og sikkerhetsventilen slipper gjennom med tom
  // liste. `myOrgs: []` betydde derfor både «ikke hentet ennå» og «ikke medlem
  // noe sted», og /org/[slug] flashet «Du er ikke medlem av denne bedriften»
  // for ekte ansatte. Enhver ny konsument som skal vise noe negativt basert på
  // en TOM myOrgs må gate på dette flagget, ikke på `loading`.
  myOrgsLoaded: boolean
  // true når siste my-orgs-forsøk feilet (401/500/nettverk). Da forblir
  // `myOrgsLoaded` false: et feilsvar er «vet ikke», aldri «ingen medlemskap»
  // (samme invariant som lib/fetch-result.ts).
  myOrgsError: boolean
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
  // Nytt forsøk på KUN org-listen — ruten for «Prøv igjen» på /org/[slug] sin
  // feilskjerm. Nullstiller myOrgsError med det samme, slik at siden faller
  // tilbake til lasteskjermen mens forsøket pågår.
  refreshMyOrgs: () => Promise<void>
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
  const [myOrgsLoaded, setMyOrgsLoaded] = useState<boolean>(false)
  const [myOrgsError, setMyOrgsError] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [resolved, setResolved] = useState<boolean>(false)

  // Dedupe-vakt (samme mønster som AuthListener.tsx): kun første event per
  // bruker-id utløser full henting. TOKEN_REFRESHED/USER_UPDATED bærer samme
  // user.id → hoppes over, så de fyrer aldri unødvendige re-fetches. Dette er
  // hele poenget: ett konsolidert kall i stedet for 5–14.
  const handledUserIdRef = useRef<string | null>(null)

  // Henter org-listen. Mappingen fra svar til { ok } bor i lib/my-orgs-fetch.ts
  // (testdekket) slik at et feilsvar blir { ok:false } og IKKE en tom liste —
  // ruten svarer nå 401/500 ved feil, og den forskjellen ville vært usynlig med
  // det gamle `r.ok ? r.json() : { orgs: [] }`-mønsteret her.
  const fetchMyOrgs = useCallback(async (token: string): Promise<Loaded<MyOrg[]>> => {
    return fetchMyOrgsResult<MyOrg>(() => fetch('/api/org/my-orgs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token }),
    }))
  }, [])

  // Ett sted som gjør resultatet om til context-state — delt av loadAll og
  // refreshMyOrgs, slik at de to ikke kan drifte fra hverandre.
  const applyMyOrgs = useCallback((result: Loaded<MyOrg[]>) => {
    if (result.ok) {
      setMyOrgs(result.value)
      setMyOrgsError(false)
      setMyOrgsLoaded(true)
      return
    }
    // Feil: `myOrgs` og `myOrgsLoaded` røres IKKE. En tidligere bekreftet liste
    // overlever dermed en transient feil (samme null-safe prinsipp som premium
    // over), og en bruker som aldri har fått svar forblir i «vet ikke» framfor
    // å bli fortalt at hen ikke er medlem.
    setMyOrgsError(true)
  }, [])

  // Full henting for en gitt sesjon: display_name + premium + myOrgs parallelt.
  const loadAll = useCallback(async (session: Session) => {
    const user = session.user
    const token = session.access_token
    setLoading(true)
    // Vi har ennå ikke noe svar for DENNE brukeren. Uten dette ville et
    // bekreftet «ingen orgs» fra utlogget tilstand (eller fra forrige bruker)
    // blitt stående som gyldig gjennom hele hentingen.
    setMyOrgsLoaded(false)
    setMyOrgsError(false)
    try {
      const [profileRes, premium, orgsResult] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
        fetchPremiumStatusFull(token, user.id),
        fetchMyOrgs(token),
      ])

      setDisplayName(profileRes.data?.display_name ?? user.email?.split('@')[0] ?? null)
      // Kun definitivt svar endrer premium — aldri nedgrader på null (feil).
      if (premium !== null) {
        setIsPremium(premium.isPremium)
        setHasStripeCustomer(premium.hasStripeCustomer)
        setPremiumSource(premium.premiumSource)
      }
      applyMyOrgs(orgsResult)
    } finally {
      setLoading(false)
    }
  }, [applyMyOrgs, fetchMyOrgs])

  // Nytt forsøk på kun org-listen (retry-knappen på /org/[slug]).
  const refreshMyOrgs = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return
    // Tilbake til «vet ikke» mens forsøket pågår — siden viser da lasteskjermen
    // i stedet for feilskjermen, uten at den trenger egen retry-state.
    setMyOrgsError(false)
    applyMyOrgs(await fetchMyOrgs(session.access_token))
  }, [applyMyOrgs, fetchMyOrgs])

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
    // Rører BEVISST ikke myOrgsLoaded: at vi gir opp å vente på auth betyr ikke
    // at vi har fått vite noe om medlemskap. Gjorde den det, ville /org/[slug]
    // vist «du er ikke medlem» på et treigt nett — som var halve produksjons-
    // buggen 31. juli.
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
        // Utlogget er et BEKREFTET svar: ingen bruker, ingen medlemskap.
        // loadAll nullstiller flagget igjen ved neste innlogging, så det kan
        // ikke bli stående som gyldig for den nye brukeren.
        setMyOrgsLoaded(true)
        setMyOrgsError(false)
        setLoading(false)
        setResolved(true)
        return
      }

      const user = session?.user
      if (!user) {
        // INITIAL_SESSION uten sesjon → utlogget, ferdig oppløst.
        if (event === 'INITIAL_SESSION') {
          clearTimeout(timeout)
          setLoading(false)
          setResolved(true)
          setMyOrgsLoaded(true)
          setMyOrgsError(false)
        }
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
      //
      // Rører BEVISST ikke myOrgsLoaded. Denne grenen fyrer typisk mens den
      // FØRSTE loadAll fortsatt er underveis (TOKEN_REFRESHED rett etter
      // INITIAL_SESSION), og satte da `loading = false` med tom liste — som
      // /org/[slug] leste som «ikke medlem». Kun loadAll sitt eget svar får
      // avgjøre medlemskap.
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
      value={{
        userId, displayName, isPremium, hasStripeCustomer, premiumSource,
        myOrgs, myOrgsLoaded, myOrgsError,
        loading, resolved, refreshProfile, refreshMyOrgs,
      }}
    >
      {children}
    </ProfileContext.Provider>
  )
}
