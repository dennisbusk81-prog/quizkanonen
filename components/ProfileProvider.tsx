'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { fetchPremiumStatusFull, hydratePremiumStatus } from '@/lib/premium-status'
import { type Loaded } from '@/lib/fetch-result'
import { fetchMyOrgsResult } from '@/lib/my-orgs-fetch'
import { toLoadedRow } from '@/lib/profile-load'

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
  // Den RÅ verdien av profiles.display_name, som en BEKREFTET henting — i
  // motsetning til `displayName` over, som er en VISNINGSVERDI med fallback til
  // e-postens lokaldel og derfor aldri kan brukes som «har brukeren satt
  // navn?»-signal (for support@quizkanonen.no «heter» brukeren support der).
  // { ok: false } = ikke hentet/feilet; { ok: true, value: null } = bekreftet
  // uten navn. Konsument: /velkommen sitt navnefelt (lib/welcome-onboarding.ts
  // sin nameFieldState). Samme Loaded-invariant som myOrgsLoaded: et feilsvar
  // er «vet ikke», aldri «mangler navn».
  displayNameRaw: Loaded<string | null>
  isPremium: boolean
  hasStripeCustomer: boolean
  premiumSource: string | null
  // true = brukeren har hatt gratis prøveperiode (profiles.has_used_trial via
  // premium-status-ruta). Konsument: profilsidens abonnement-kort, som skal
  // si «prøveperioden er over» — ikke «kortet gikk ikke gjennom» — til en
  // Stripe-kunde som aldri la inn kort. Samme null-safe regel som isPremium:
  // kun et definitivt serversvar endrer verdien.
  hasUsedTrial: boolean
  // true = founders-farvel-flaten er lukket (varig stempel i profiles).
  // Konsument: FoundersFarewellBanner via gaten i lib/founders-farewell.ts,
  // som bevisst leser alle tre signalene (hasUsedTrial/isPremium/denne) fra
  // SAMME definitive serversvar — se kommentaren der om flash-sikkerhet.
  foundersFarewellDismissed: boolean
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
  // true mens et refreshMyOrgs()-forsøk er underveis. Skilt fra myOrgsError
  // fordi de to svarer på ulike spørsmål: «feilet forrige forsøk?» og «pågår
  // det et nytt akkurat nå?». Fram til 19. august 2026 fantes bare det første,
  // og retry-knappen nullstilte det i klikkøyeblikket for å simulere det andre
  // — se lib/retry-affordance.ts.
  myOrgsRefreshing: boolean
  // true når profildata (premium/orgs) fortsatt hentes.
  loading: boolean
  // true straks innlogget/utlogget-status er avgjort (første auth-event eller
  // timeout) — uavhengig av om profildata er ferdig hentet. Brukes av chrome
  // (NavAuth) til å unngå å flashe feil innloggingstilstand.
  resolved: boolean
  // Tvinger en fersk server-sjekk av premium-status og oppdaterer context.
  // Null-safe: nedgraderer ALDRI på transient feil (behold forrige verdi).
  // Dette er ruten for de bevisste resjekkene (quiz-start, quiz-innsending,
  // leaderboard fane-fokus) — samme oppførsel som deres tidligere egne kall.
  refreshProfile: () => Promise<void>
  // Nytt forsøk på KUN org-listen — ruten for «Prøv igjen» på /org/[slug] sin
  // feilskjerm og for de to inline-lenkene på resultat-/topplisteflatene.
  // Rører IKKE myOrgsError før svaret er inne; mellomtilstanden bæres av
  // myOrgsRefreshing.
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
  const [displayNameRaw, setDisplayNameRaw] = useState<Loaded<string | null>>({ ok: false })
  const [isPremium, setIsPremium] = useState<boolean>(false)
  const [hasStripeCustomer, setHasStripeCustomer] = useState<boolean>(false)
  const [premiumSource, setPremiumSource] = useState<string | null>(null)
  const [hasUsedTrial, setHasUsedTrial] = useState<boolean>(false)
  const [foundersFarewellDismissed, setFoundersFarewellDismissed] = useState<boolean>(false)
  const [myOrgs, setMyOrgs] = useState<MyOrg[]>([])
  const [myOrgsLoaded, setMyOrgsLoaded] = useState<boolean>(false)
  const [myOrgsError, setMyOrgsError] = useState<boolean>(false)
  const [myOrgsRefreshing, setMyOrgsRefreshing] = useState<boolean>(false)
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
    // Samme grunn: et bekreftet navn fra forrige bruker skal ikke stå som
    // gyldig mens den nyes henting pågår.
    setDisplayNameRaw({ ok: false })
    try {
      const [profileRes, premium, orgsResult] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
        fetchPremiumStatusFull(token, user.id),
        fetchMyOrgs(token),
      ])

      // Samme null-safe regel som premium under og myOrgs i applyMyOrgs: kun et
      // BEKREFTET svar får endre contexten. `profileRes.data?.…` leste tidligere
      // kun `.data`, så en spørringsfeil (RLS-avslag, 500, nettverksbrudd) ble
      // umulig å skille fra «raden har ikke noe navn» — og hele appen fikk da
      // e-postens lokaldel presentert som visningsnavn i NavAuth.
      // Ved feil beholdes forrige verdi; en bruker som ser navnet sitt skal ikke
      // se det bli til «dennisbusk81» fordi en re-henting feilet.
      const nameRow = toLoadedRow<{ display_name: string | null }>(profileRes)
      if (nameRow.ok) {
        // Lokaldelen er fortsatt riktig fallback for en BEKREFTET tom rad —
        // brukeren finnes, men har ikke satt navn ennå.
        setDisplayName(nameRow.value?.display_name ?? user.email?.split('@')[0] ?? null)
        // Den rå kolonneverdien, UTEN fallbacken over — settes kun her, på et
        // bekreftet svar. Ved feil forblir den { ok: false } («vet ikke»).
        setDisplayNameRaw({ ok: true, value: nameRow.value?.display_name ?? null })
      }
      // Kun definitivt svar endrer premium — aldri nedgrader på null (feil).
      if (premium !== null) {
        setIsPremium(premium.isPremium)
        setHasStripeCustomer(premium.hasStripeCustomer)
        setPremiumSource(premium.premiumSource)
        setHasUsedTrial(premium.hasUsedTrial)
        setFoundersFarewellDismissed(premium.foundersFarewellDismissed)
      }
      applyMyOrgs(orgsResult)
    } finally {
      setLoading(false)
    }
  }, [applyMyOrgs, fetchMyOrgs])

  // Nytt forsøk på kun org-listen (retry-knappen på /org/[slug]).
  const refreshMyOrgs = useCallback(async () => {
    // myOrgsError står URØRT her. Den nullstilles først av applyMyOrgs, og kun
    // ved et faktisk OK-svar. Nullstilte vi den her, ville feilteksten og
    // knappen forsvunnet i klikkøyeblikket på de to flatene som gates på den
    // — brukeren ser da et avsnitt blinke bort og ingenting skje.
    setMyOrgsRefreshing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      // Ingen sesjon: ingenting å hente. Feiltilstanden beholdes bevisst —
      // vi har ikke fått noe nytt svar, så det gamle står fortsatt.
      if (!session?.access_token) return
      applyMyOrgs(await fetchMyOrgs(session.access_token))
    } finally {
      // Alltid. Uten dette låser ett kastet getSession() knappen i «Prøver …»
      // — samme feilform som den vi nettopp fjernet, bare med nytt fortegn.
      setMyOrgsRefreshing(false)
    }
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
      setHasUsedTrial(premium.hasUsedTrial)
      setFoundersFarewellDismissed(premium.foundersFarewellDismissed)
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
        setDisplayNameRaw({ ok: false })
        setIsPremium(false)
        setHasStripeCustomer(false)
        setPremiumSource(null)
        setHasUsedTrial(false)
        setFoundersFarewellDismissed(false)
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
        userId, displayName, displayNameRaw, isPremium, hasStripeCustomer, premiumSource, hasUsedTrial,
        foundersFarewellDismissed,
        myOrgs, myOrgsLoaded, myOrgsError, myOrgsRefreshing,
        loading, resolved, refreshProfile, refreshMyOrgs,
      }}
    >
      {children}
    </ProfileContext.Provider>
  )
}
