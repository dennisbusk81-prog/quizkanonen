'use client'
import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { supabase, supabaseData, Quiz, Attempt } from '@/lib/supabase'
import { rankAttempts, RankedAttempt } from '@/lib/ranking'
import { getSession, signOut } from '@/lib/auth'
import { getSessionIdentity } from '@/lib/session-identity'
import AuthModal from '@/components/AuthModal'
import SiteNav from '@/components/SiteNav'
import { useProfile } from '@/components/ProfileProvider'
import Link from 'next/link'
import SkeletonCard from '@/components/SkeletonCard'
import { getAvatarInitial } from '@/lib/avatar-initial'
import BadgeCircle, { type BadgeKind } from '@/components/BadgeCircle'
import ResultsTable, { type ResultsTableRow } from '@/components/ResultsTable'
import DuelChallengeModal from '@/components/DuelChallengeModal'
import { computeDuelAffordance } from '@/lib/duel-affordance'
import { decidePlacementDisplay, shouldOfferPlacementRetry, shouldShowFreePlacementCard } from '@/lib/placement-visibility'
import { describeRetry } from '@/lib/retry-affordance'
import { decideOrgScopeNotice } from '@/lib/org-scope-notice'
// Datolesing på quiz-raden: ALLTID via isQuizClosed/decideHiddenUntilClosed —
// aldri rå `new Date(quiz.closes_at)`. NULL er «stenger aldri», ikke epoch
// 1970, og serverruten (app/api/leaderboard/[id]) leser samme felt med samme
// funksjoner — paritetskravet fra NONNULL-sveipet 26. august 2026 (B1).
import { isQuizClosed } from '@/lib/standings-cache'
import { decideHiddenUntilClosed, decideHiddenLeaderboardView, osloClosingTime } from '@/lib/leaderboard-visibility'
import { decideFetchScope } from '@/lib/org-scope-fetch'
import { fetchResult, type Loaded } from '@/lib/fetch-result'
import { decideLeagueAffordance } from '@/lib/league-affordance'
import type { Session } from '@supabase/supabase-js'
import { withTimeout } from '@/lib/with-timeout'

// SPINNER-BUDSJETT på getSession() — hvor lenge siden holdes tilbake, IKKE en
// frist på sesjonen: fornyelsen fortsetter i bakgrunnen etter tidsavbruddet,
// og når den lander tilbys org-visningen som knapp (se decideFetchScope).
//
// Tallgrunnlag (scripts/measure-supabase-auth-rtt.mjs, 19. august 2026,
// Oslo → eu-west-1, kablet): token-POST median 140 ms varm, maks 175 ms;
// kald forbindelse 413 ms (TLS-påslag ≈ 289 ms). Modellert dårlig mobil
// (fornyelse ≈ 3–4 rundturer inkl. DNS/TCP/TLS): 400 ms RTT («4G under
// trengsel») ≈ 1600 ms — over den gamle grensen på 1500 ms, innenfor 2500 ms.
// 2500 ms er ~18× målt varm median og slipper først gjennom når forbindelsen
// er så dårlig at siden uansett må vises. NB: 3025 ms i eldre notater var
// stub-forsinkelsen i verifiseringsskriptet, ikke en målt fornyelsestid —
// ikke bruk det tallet. Endres verdien: kjør måleskriptet på nytt først.
// (SeasonLeaderboard.tsx har fortsatt 1500 — der styrer grensen kun egen-rad/
// premium-visning, ikke en scope-beslutning, og er ikke hevet i denne runden.)
const SESSION_CHECK_MS = 2500

const podiumStyles = `
  @keyframes podiumSlideIn {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .podium-row-3 { animation: podiumSlideIn 300ms ease-out both; animation-delay: 0ms; }
  .podium-row-2 { animation: podiumSlideIn 300ms ease-out both; animation-delay: 400ms; }
  .podium-row-1 { animation: podiumSlideIn 300ms ease-out both; animation-delay: 1000ms; }
  @keyframes podiumFadeIn { from { opacity: 0; } to { opacity: 1; } }
  .podium-rest  { animation: podiumFadeIn 200ms ease-out both; animation-delay: 1400ms; }

  @media (min-width: 769px) {
    .qk-lb-card        { padding: 28px 32px !important; }
    .qk-lb-result-wrap { flex-direction: row !important; align-items: center !important; justify-content: space-between !important; text-align: left !important; padding: 16px 24px !important; gap: 20px !important; }
    .qk-lb-hero-score  { font-size: 36px !important; }
    .qk-lb-score-label { font-size: 18px !important; }
    .qk-lb-meta-row    { justify-content: flex-end !important; }
  }
`

const s = {
  wrap:         { minHeight: '100vh', background: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", color: '#e8e4dd' },
  // 900px, ikke 680: bredde-regelen fra e79f6b2 (13. juni 2026) satte 680 for
  // «enkeltside-innhold» og 900 for «innholdsrike sider». Denne siden var
  // kort-basert den gang; siden ResultsTable ble innført 26. juli er den en
  // 4-kolonners tabellside på linje med /toppliste og /org/[slug], og hører
  // derfor i 900-gruppen. Samme flytting gjort for /liga/[slug].
  page:         { maxWidth: 900, margin: '0 auto', padding: '0 20px 80px' },
  centered:     { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  centeredText: { fontFamily: "var(--font-libre-baskerville), serif", fontSize: 18, color: '#918f8a', fontStyle: 'italic' as const },
  // Samme form som «Prøv igjen»-knappen på org-admin-panelets vinnerkort.
  retryBtn: { fontSize: 12, padding: '6px 14px', border: '1px solid #2a2d38', borderRadius: 6, background: 'transparent', color: '#e8e4dd', cursor: 'pointer', fontFamily: "var(--font-instrument-sans), sans-serif" },

  header:   { padding: '48px 0 36px', textAlign: 'center' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 20, letterSpacing: '0.04em' },
  eyebrow:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 8 },
  title:    { fontFamily: "var(--font-libre-baskerville), serif", fontSize: 'clamp(28px, 6vw, 38px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 6 },
  titleEm:  { fontStyle: 'italic', color: '#c9a84c' },
  subtitle: { fontFamily: "var(--font-libre-baskerville), serif", fontSize: 14, color: '#e8e4dd', fontStyle: 'italic' as const },
  rule:     { width: '100%', height: 1, background: '#2a2d38', marginTop: 32 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '32px 0 14px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#918f8a', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#918f8a', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  profileBar: { background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 20, padding: '14px 20px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 },
  avatar:     { width: 34, height: 34, borderRadius: '50%', background: '#2a2d38', border: '1.5px solid rgba(201,168,76,0.22)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#c9a84c', overflow: 'hidden' as const },

  card:       { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px 24px', marginBottom: 12 },
  cardRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' as const },
  cardTitle:  { fontSize: 14, fontWeight: 700, color: '#ffffff', marginBottom: 3 },
  cardSub:    { fontSize: 12, color: '#918f8a' },

  btnGold:    { display: 'inline-flex', alignItems: 'center', gap: 8, background: '#c9a84c', color: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0, textDecoration: 'none' },
  btnOutline: { background: 'none', color: '#e8e4dd', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 12, fontWeight: 600, padding: '4px 0', border: 'none', cursor: 'pointer' },
  btnMore:    { width: '100%', padding: 12, background: '#21242e', border: '1px solid #2a2d38', borderRadius: 10, color: '#e8e4dd', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "var(--font-instrument-sans), sans-serif", marginTop: 4, marginBottom: 16 },

  tabRow:     { display: 'flex', borderBottom: '1px solid #2a2d38', marginBottom: 16 },
  tabActive:  { padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid #c9a84c', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#c9a84c', fontFamily: "var(--font-instrument-sans), sans-serif", cursor: 'pointer' },
  tabInactive:{ padding: '10px 16px', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1, fontSize: 13, fontWeight: 600, color: '#e8e4dd', fontFamily: "var(--font-instrument-sans), sans-serif", cursor: 'pointer' },
  tabEmpty:   { padding: '24px 0', textAlign: 'center' as const, fontSize: 13, color: '#918f8a', fontStyle: 'italic' as const },

  empty:     { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '56px 32px', textAlign: 'center' as const, marginTop: 32 },
  emptyIcon: { fontSize: 44, marginBottom: 16, opacity: 0.5 },
  emptyTitle:{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 20, color: '#ffffff', marginBottom: 8 },
  emptySub:  { fontSize: 13, color: '#918f8a', lineHeight: 1.6, marginBottom: 24 },
  btnLink:   { display: 'inline-block', background: 'transparent', color: '#e8e4dd', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 14, fontWeight: 600, padding: '10px 28px', border: '1px solid #2a2d38', borderRadius: 10, textDecoration: 'none' },
}


// Felles entry-form fra /api/leaderboard/[id]
type LbEntry = {
  rank: number
  id: string
  userId: string | null
  playerName: string
  nickname?: string | null
  correctAnswers: number
  totalQuestions: number
  totalTimeMs: number
  correctStreak: number | null
  leaderDisplayName: string | null
}

function entryToAttempt(e: LbEntry, quizId: string): Attempt {
  return {
    id: e.id,
    quiz_id: quizId,
    player_name: e.playerName,
    is_team: false,
    team_size: 1,
    correct_answers: e.correctAnswers,
    total_questions: e.totalQuestions,
    total_time_ms: e.totalTimeMs,
    correct_streak: e.correctStreak,
    user_id: e.userId,
    completed_at: '',
    leader_display_name: e.leaderDisplayName,
  }
}

const BROWSE_PAGE_SIZE = 20

export default function LeaderboardPage() {
  const params = useParams()
  const quizId = params.id as string
  const searchParams = useSearchParams()
  const router = useRouter()
  // Org-modus: ?org=<slug> scoper visningen til én bedrift. null = nasjonal (uendret).
  const orgSlug = searchParams.get('org')?.trim() || null
  // Liga-modus: kun brukt til "tilbake til liga-topplisten"-lenken nederst —
  // ingen datahenting/gating endres her (utenfor omfanget av denne fiksen,
  // se components/SeasonLeaderboard.tsx sin buildQuizHref()).
  const leagueSlug = searchParams.get('league')?.trim() || null
  // hist=1 betyr at brukeren kom via "Tidligere quizer"-historikken i
  // SeasonLeaderboard — brukes til å ta dem rett tilbake til samme åpne
  // fane i stedet for "Siste quiz" ved retur.
  const cameFromHistory = searchParams.get('hist') === '1'
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [profile, setProfile] = useState<{ display_name: string | null } | null>(null)
  // Premium + org-medlemskap fra delt context (ProfileProvider).
  // userId/myOrgsLoaded mater decidePlacementDisplay — samme kilde som myOrgs.
  // myOrgsError/refreshMyOrgs er utveien når org-svaret har FEILET og
  // 'unknown' derfor aldri retter seg selv — se shouldOfferPlacementRetry.
  const {
    isPremium, myOrgs, myOrgsLoaded, userId: profileUserId, refreshProfile,
    myOrgsError, myOrgsRefreshing, refreshMyOrgs, loading: profileLoading,
  } = useProfile()
  const [authLoading, setAuthLoading] = useState(true)
  // Org-scopet hentingen FAKTISK brukte — ikke «feilet det?», men «hva ligger
  // her nå?». Skrives ett sted (fetchData) og leses av decideOrgScopeNotice.
  //
  // Var tidligere en boolean `orgScopeDegraded`. Den var klebrig og kunne bli
  // foreldet når auth kom seg. Å nullstille den ved gjenoppretting var den
  // nærliggende fiksen og ville vært en regresjon: «Resultater blant kollegene
  // dine» er gatet på det samme flagget, så uten en ny henting hadde vi lovet
  // kolleger over den nasjonale lista. Se lib/org-scope-notice.ts.
  const [servedOrgSlug, setServedOrgSlug] = useState<string | null>(null)
  // Klikket på «Vi fant bedriften din — vis kollegene». Byttet til org-lista
  // er en HANDLING (avgjort 19. august 2026): lander sesjonen etter at siden
  // er tegnet, tilbys byttet — lista bytter aldri populasjon under lesing.
  // Flagget nullstilles av fetchData når hentingen det utløste er avgjort.
  const [orgScopeUpgradeRequested, setOrgScopeUpgradeRequested] = useState(false)
  // HENDELSE, ikke UI-tilstand: har denne sidelastingen allerede vist leseren
  // en nasjonal liste for en ?org=-lenke? Mater decideFetchScope, slik at den
  // automatiske paritetsrefetchen (identitetsskifte når fornyelsen lander)
  // beholder nasjonal visning i stedet for å bytte under leseren. UI-teksten
  // utledes fortsatt KUN av servedOrgSlug — dette er fetch-policy, ikke det
  // gamle orgScopeDegraded-flagget i ny drakt (se lib/org-scope-fetch.ts).
  const nationalServedForOrgRef = useRef(false)
  const [visibleSoloCount, setVisibleSoloCount] = useState(10)
  const [scrollPending, setScrollPending] = useState(false)
  const [savedResult, setSavedResult] = useState<{ correct_answers: number; total_time_ms: number } | null>(null)
  const [friendNames, setFriendNames] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'alle' | 'venner'>('alle')
  const [visibleVennerCount, setVisibleVennerCount] = useState(10)
  const [memberInfoMap, setMemberInfoMap] = useState<Map<string, { member_number: number | null, show_member_number: boolean, avatar_url: string | null, display_name: string | null, nickname: string | null }>>(new Map())
  const [prevRankMap, setPrevRankMap] = useState<Map<string, number>>(new Map())
  const [mostImprovedName, setMostImprovedName] = useState<string | null>(null)
  const [podiumActive, setPodiumActive] = useState(false)
  // «Vet ikke» er ikke «har ikke»: en feilet /api/leagues skal hverken skjule
  // «Blant venner»-fanen ELLER tenne «Opprett en liga (Premium)»-CTA-en.
  // Beslutningen ligger i lib/league-affordance.ts.
  const [leaguesState, setLeaguesState] = useState<Loaded<boolean>>({ ok: false })
  const [activeDuelExists, setActiveDuelExists] = useState(false)
  const [challengeSentSet, setChallengeSentSet] = useState<Set<string>>(new Set())
  const [duelInvolvedSet, setDuelInvolvedSet] = useState<Set<string>>(new Set())
  const [challengeLoadingId, setChallengeLoadingId] = useState<string | null>(null)
  const [challengeError, setChallengeError] = useState<{ rivalId: string; message: string } | null>(null)
  // Trykk-på-rad åpner denne i stedet for å kalle handleChallenge direkte —
  // se ResultsTable sin onRowClick. Ingen mellomsteg-meny: kuttet fra
  // opprinnelig brief siden «Inviter til liga» (det andre menyvalget) viste
  // seg ikke byggbart (ingen mekanisme for å rette en invitasjon mot en
  // navngitt bruker finnes noe sted i kodebasen) — med kun duell igjen ville
  // en meny med ett valg vært en unødvendig ekstra tapp.
  const [pendingChallenge, setPendingChallenge] = useState<{ id: string; name: string } | null>(null)
  const userOrgs = myOrgs.map(o => ({ orgSlug: o.orgSlug, orgName: o.orgName }))
  // Hvilken plassering denne brukeren skal se — se lib/placement-visibility.ts.
  // Gjelder KUN den nasjonale visningen: org-visningen (?org=) ER den interne
  // plasseringen og er alltid legitim for et verifisert medlem.
  const placementDisplay = decidePlacementDisplay({
    userId: profileUserId,
    orgsLoaded: myOrgsLoaded,
    orgs: myOrgs,
  })
  // Blokkert (stengt org / eget opt-out): den offentlige listen vises som
  // normalt — de skal kunne SE konkurransen — men uten brukerens egen
  // offentlige plassering (hero-kortets «Plass X av Y», persentilen,
  // delingstallet og «Gå til min plassering»). 'unknown' behandles likt:
  // før org-svaret har landet vet vi ikke om tallet er lov å vise.
  const suppressOwnPublicRank = !orgSlug
    && (placementDisplay.mode === 'internal-only' || placementDisplay.mode === 'unknown')
  // Intern plassering for «begge tall»-visningen (org som deltar åpent) —
  // hentes i egen effekt under.
  const [internalSolo, setInternalSolo] = useState<{ rank: number | null; total: number } | null>(null)
  const [fetchError, setFetchError] = useState(false)
  // Retry for hovedlasten: bumpes av «Prøv igjen» på feilskjermen. Knappen
  // nuller også listFetchKeyRef — paritetsvakten i effekten ville ellers
  // kortsluttet et nytt forsøk med samme identitet.
  const [fetchAttempt, setFetchAttempt] = useState(0)
  const [shareCopied, setShareCopied] = useState(false)
  const [challengeCopied, setChallengeCopied] = useState(false)
  // Fix 3: store timer ref so it can be cleared on unmount
  const challengeErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stabil identitet for siste kjørte loadSession() — se lib/session-identity.ts.
  // Sentinel-verdi sikrer at aller første sammenligning alltid avviker, slik at
  // mount-oppførselen er uendret; kun SENERE samme-bruker-events (typisk
  // TOKEN_REFRESHED ved fane-fokus) hopper over den tunge loadSession()-kaskaden.
  const lastSessionIdentityRef = useRef<string>('__not_loaded_yet__')

  type AnswerDistQuestion = {
    questionId: string
    questionText: string
    correctAnswers: string[]
    totalAnswers: number
    correctPct: number
    distribution: { option: string; label: string; count: number; percent: number }[]
  }
  // Svarfordeling krever innlogging + Premium (se lib/premium-check.ts og
  // /api/quiz/[id]/answer-distribution) — API-et returnerer kun de to
  // letteste + to vanskeligste spørsmålene, ikke alle. `premiumRequired`
  // skilles fra andre feil slik at UI-et kan vise en CTA i stedet for en
  // generisk feilmelding.
  const [answerDist, setAnswerDist] = useState<{ easiest: AnswerDistQuestion[]; hardest: AnswerDistQuestion[] } | null>(null)
  const [answerDistLoading, setAnswerDistLoading] = useState(false)
  const [showAnswerDist, setShowAnswerDist] = useState(false)
  const [answerDistPremiumRequired, setAnswerDistPremiumRequired] = useState(false)

  // Server-side totaler + brukerens eksakte plassering (også utenfor topp 50)
  const [soloTotal, setSoloTotal] = useState(0)
  const [serverUserSolo, setServerUserSolo] = useState<RankedAttempt | null>(null)
  // Gjestens server-beregnede plasseringsestimat (10-båndets start, bandet av
  // serveren). Trappen gjør at en uinnlogget klient kun ser topp 3 — det
  // lokale «tell bedre rader»-estimatet kan derfor ikke lenger regnes her.
  const [serverGuestRank, setServerGuestRank] = useState<number | null>(null)

  // Premium browse-modus (paginering + søk) for "Alle"/"Lag"
  const [browseMode, setBrowseMode]               = useState(false)
  const [browsePage, setBrowsePage]               = useState(1)
  const [browseSearchInput, setBrowseSearchInput] = useState('')
  const [browseSearch, setBrowseSearch]           = useState('')
  const [browseData, setBrowseData]   = useState<{ entries: LbEntry[]; totalCount: number; userRank: number | null } | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)
  // Feil er ikke tomt (lib/fetch-result.ts): fram til 29. august 2026 kollapset
  // både !res.ok og catch til browseData=null, som renderBrowseList leste som
  // «Ingen resultater.» — en faktapåstand om et søk/en side vi aldri fikk svar
  // på. Feilen har egen state; browseAttempt er retry-knappens vei til å
  // re-kjøre henteeffekten (samme form som hentForsok i app/arkiv/page.tsx).
  const [browseError, setBrowseError] = useState(false)
  const [browseAttempt, setBrowseAttempt] = useState(0)

  // «Begge tall»: org-medlemmer i en org som deltar åpent får det interne
  // tallet i tillegg til det offentlige i hero-kortet. Egen effekt (ikke i
  // loadSession) fordi myOrgs lander asynkront fra ProfileProvider — effekten
  // re-kjører når org-svaret kommer. Samme rute og medlemskaps-gate som
  // ?org=-visningen; limit=1 fordi kun userRank/totalCount trengs.
  useEffect(() => {
    if (orgSlug) return // org-visningen ER intern — ingen ekstra henting
    if (placementDisplay.mode !== 'both') return
    const token = session?.access_token
    if (!token) return
    const slug = placementDisplay.org.orgSlug
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/leaderboard/${quizId}?is_team=false&limit=1&org=${encodeURIComponent(slug)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) return
        const j: { userRank?: number | null; totalCount?: number } = await res.json()
        if (!cancelled && typeof j?.totalCount === 'number') {
          setInternalSolo({ rank: j.userRank ?? null, total: j.totalCount })
        }
      } catch { /* intern plassering er et tillegg — siden skal ikke feile på den */ }
    })()
    return () => { cancelled = true }
  }, [orgSlug, placementDisplay.mode, placementDisplay.org?.orgSlug, session?.access_token, quizId])

  // Full nøkkel for siste liste-henting: quiz + org + identiteten kallet
  // FAKTISK ble gjort med. Effekten under bruker den til å skille «session-
  // state landet med samme identitet som mount-hentingen alt brukte» (skal
  // ikke koste et nytt kall) fra en ekte identitetsendring (skal det).
  const listFetchKeyRef = useRef<string | null>(null)
  const sessionIdentity = getSessionIdentity(session)

  useEffect(() => {
    // [P-3] PARITET: serveren kutter nå listen per brukertrinn (trappen), så
    // svaret avhenger av hvem som spør. Når loadSession setter `session` med
    // SAMME identitet som fetchData selv leste ved mount, er listen allerede
    // riktig — hopp over. En faktisk endring (innlogging via modalen,
    // utlogging) må derimot hente listen på nytt, ellers står 3-raders-svaret
    // igjen hos en som nettopp logget inn.
    // Klikket på «vis kollegene» endrer ingen av nøkkel-komponentene (samme
    // quiz, samme org, samme identitet) — det må derfor forbi vakten selv.
    if (!orgScopeUpgradeRequested
      && listFetchKeyRef.current === `${quizId}|${orgSlug ?? ''}|${sessionIdentity}`) return
    async function fetchData() {
      try {
        // Trappen gjør identiteten til en del av selve liste-svaret: uten
        // token svarer serveren med gjestetrinnet (3 rader) uansett hvem
        // klienten mener den er. Kallet sendes derfor ALLTID med token når
        // det finnes — også i nasjonal modus, som fram til 23. august 2026
        // gikk anonymt (feilen var maskert fordi gratis så alt uansett).
        let authHeader: Record<string, string> = {}
        // Tidsgrense (19. august 2026): dette awaitet lå FØR den eneste
        // setLoading(false) (finally lenger nede). Et kast var dekket, men et
        // getSession() som HENGER på auth-låsen settles aldri — og da kjørte
        // hverken catch eller finally. Siden ble stående og spinne, uten feil,
        // uten logg, uten vei videre for brukeren utenom omlasting.
        const outcome = await withTimeout(getSession(), { ms: SESSION_CHECK_MS })
        // Nøkkelen skrives med identiteten vi FAKTISK brukte. Henger
        // getSession (utfallet er «vet ikke» → anonymt kall), blir nøkkelen
        // 'anon' — og når loadSession senere lander med en ekte bruker,
        // avviker identiteten og listen hentes på nytt med token.
        listFetchKeyRef.current =
          `${quizId}|${orgSlug ?? ''}|${getSessionIdentity(outcome.ok ? outcome.value : null)}`
        if (outcome.ok && outcome.value?.access_token) {
          authHeader = { Authorization: `Bearer ${outcome.value.access_token}` }
        }
        // scopedOrg, ikke orgSlug, styrer HENTINGEN nedenfor: org-scopet kan
        // falle bort uten at lenken gjør det (spinner-budsjettet brukt opp —
        // verken heng eller feil er et svar på «er du innlogget?», så vi
        // faller til nasjonal visning i stedet for å påstå utlogget med en
        // /login-redirect). Et bortfalt scope kommer bare tilbake via knappen
        // «vis kollegene» — aldri ved at den automatiske paritetsrefetchen
        // (identitetsskifte når fornyelsen lander) bytter lista under leseren.
        // Hele beslutningen bor i lib/org-scope-fetch.ts (testdekket).
        const scopeDecision = decideFetchScope({
          requestedOrg: orgSlug,
          sessionKnown: outcome.ok,
          nationalAlreadyServed: nationalServedForOrgRef.current,
          upgradeRequested: orgScopeUpgradeRequested,
        })
        const scopedOrg = scopeDecision.scope
        if (scopedOrg && !authHeader.Authorization) {
          // Sesjonen SVARTE (ellers hadde beslutningen falt til nasjonal), og
          // svaret var «ingen»: en utlogget besøkende på en org-lenke.
          router.push(`/login?next=${encodeURIComponent(`/leaderboard/${quizId}?org=${orgSlug}`)}`)
          return
        }
        nationalServedForOrgRef.current = scopeDecision.nationalServedForOrg
        // Samme setning som bestemmer URL-en bestemmer hva vi sier om den.
        // Skriver de to hver for seg, kan de drifte fra hverandre — og da lyver
        // enten teksten eller lista.
        setServedOrgSlug(scopedOrg)
        // Klikk-flagget har gjort jobben sin uansett utfall: ble scopet
        // servert, forsvinner knappen (notice blir 'colleagues'); falt vi til
        // nasjonal igjen (nytt tidsavbrudd), skal knappen kunne klikkes på
        // nytt. Samme verdi → React bailer ut, så no-op i normalflyten.
        setOrgScopeUpgradeRequested(false)
        const orgQS = scopedOrg ? `&org=${encodeURIComponent(scopedOrg)}` : ''

        // Gjest med lagret resultat: be serveren om det (bandede)
        // plasseringsestimatet i samme kall. Leses rett fra localStorage i
        // stedet for savedResult-staten — den settes i en egen effekt og er
        // ikke garantert å ha landet før dette kallet går.
        let guestQS = ''
        if (!authHeader.Authorization) {
          try {
            const saved = localStorage.getItem(`qk_result_${quizId}`)
            if (saved) {
              const r = JSON.parse(saved) as { correct_answers?: number; total_time_ms?: number }
              if (typeof r?.correct_answers === 'number' && typeof r?.total_time_ms === 'number') {
                guestQS = `&my_correct=${r.correct_answers}&my_time=${r.total_time_ms}`
              }
            }
          } catch { /* utilgjengelig localStorage — estimatet utgår */ }
        }

        // Klassisk visning henter topp 50 per rom server-side (rangert via RPC,
        // med JS-fallback). Serveren klemmer mot kallerens trinn: 3 for
        // gjester, 10 for gratis, 50 for Premium/org.
        const [{ data: quizData, error: e1 }, soloRes] = await Promise.all([
          supabaseData.from('quizzes').select('*').eq('id', quizId).single(),
          // Feil er ikke tomt: et !ok-svar her ble til soloRes=null → attempts=[]
          // → «Ingen resultater ennå» — en faktapåstand om en liste vi aldri
          // fikk. Kastet lander i catch under, som setter fetchError (ekte
          // feilskjerm med retry) i stedet.
          fetch(`/api/leaderboard/${quizId}?is_team=false&limit=50${orgQS}${guestQS}`, { headers: authHeader }).then(r => { if (!r.ok) throw new Error(`leaderboard-listen svarte ${r.status}`); return r.json() }),
        ])
        if (e1) throw e1
        setQuiz(quizData)
        const soloRows: LbEntry[] = soloRes?.entries ?? []
        setSoloTotal(soloRes?.totalCount ?? soloRows.length)
        setServerGuestRank(typeof soloRes?.guestRank === 'number' ? soloRes.guestRank : null)
        // `userEntry` lå allerede i DETTE svaret, men ble ikke lest — den ble
        // kun hentet av loadSoloPlacement (limit=1) i sesjons-effekten. Fra
        // 29. august 2026 avgjør den også om skjulingen løftes (isHidden), og
        // da er ett kall for sent: en gratisbruker UTENFOR topp 10 ville sett
        // ventekortet blinke til det andre kallet landet. Samme svar, ingen ny
        // rundtur — bare lest i den tick-en `entries` settes.
        //
        // Kun når raden faktisk finnes: et svar uten `userEntry` skal ikke
        // NULLE en rad loadSoloPlacement allerede har satt. De to kallene kan
        // lande i vilkårlig rekkefølge, og «vet ikke» er ikke «har ikke spilt».
        if (soloRes?.userEntry) {
          setServerUserSolo({
            ...entryToAttempt(soloRes.userEntry, quizId),
            rank: soloRes.userEntry.rank,
            isTied: false,
          })
        }
        const attemptsResult: Attempt[] = soloRows.map(e => entryToAttempt(e, quizId))
        setAttempts(attemptsResult)

        const userIds = [...new Set(attemptsResult.map((a: Attempt) => a.user_id).filter((id): id is string => !!id))]
        if (userIds.length > 0) {
          const map = new Map<string, { member_number: number | null, show_member_number: boolean, avatar_url: string | null, display_name: string | null, nickname: string | null }>()
          const { data: memberProfiles } = await supabaseData
            .from('profiles')
            .select('id, member_number, show_member_number, display_name, nickname')
            .in('id', userIds)
          if (memberProfiles) {
            for (const p of memberProfiles as { id: string, member_number: number | null, show_member_number: boolean | null, display_name: string | null, nickname: string | null }[]) {
              map.set(p.id, { member_number: p.member_number ?? null, show_member_number: p.show_member_number ?? false, avatar_url: null, display_name: p.display_name ?? null, nickname: p.nickname ?? null })
            }
          }
          // Overlay kallenavn fra server-API (omgår evt. kolonne-grants på profiles
          // som blokkerer anon-lesing av nickname). Autoritativ kilde for nickname.
          for (const e of soloRows) {
            if (!e.userId) continue
            const existing = map.get(e.userId)
            if (existing) existing.nickname = e.nickname ?? existing.nickname
            else map.set(e.userId, { member_number: null, show_member_number: false, avatar_url: null, display_name: null, nickname: e.nickname ?? null })
          }
          setMemberInfoMap(map)
        }

        // Forrige quiz' rangering for "pil opp"-merket — server-side fordi
        // attempts.user_id ikke lenger er lesbar med anon-nøkkelen.
        try {
          const prevRes = await fetch(
            `/api/leaderboard/${quizId}/prev-rank${scopedOrg ? `?org=${encodeURIComponent(scopedOrg)}` : ''}`,
            { headers: authHeader },
          )
          if (prevRes.ok) {
            const { prevRanks } = await prevRes.json() as { prevRanks: Record<string, number> }
            if (prevRanks && Object.keys(prevRanks).length > 0) {
              setPrevRankMap(new Map(Object.entries(prevRanks)))
            }
          }
        } catch { /* Previous quiz data is optional */ }
      } catch (e) {
        console.error('fetchData (leaderboard) feilet:', e)
        setFetchError(true)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId, orgSlug, sessionIdentity, orgScopeUpgradeRequested, fetchAttempt])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`qk_result_${quizId}`)
      if (saved) setSavedResult(JSON.parse(saved))
    } catch {}
  }, [quizId])

  // SØSKEN til tidsgrensen i fetchData (19. august 2026), og verre: her fantes
  // hverken try, catch eller finally. `authLoading` gater ni render-blokker —
  // plassering, del-knapp, ligakort, «Prøv igjen»-lenken — så et getSession()
  // som kastet ELLER hang lot dem alle stå uskrevne for resten av økta. I
  // motsetning til fetchData rammet dette også nasjonal visning.
  const loadSession = useCallback(async () => {
    setAuthLoading(true)
    try {
    const outcome = await withTimeout(getSession(), { ms: SESSION_CHECK_MS })
    // Ingen svar er «vet ikke», og for denne siden er «vet ikke» det samme som
    // utlogget: den nasjonale listen vises for alle, og de innlogget-gatede
    // blokkene uteblir — nøyaktig som for en besøkende uten konto.
    const sess = outcome.ok ? outcome.value : null
    setSession(sess)
    lastSessionIdentityRef.current = getSessionIdentity(sess)
    if (sess?.user) {
      const user = sess.user
      const accessToken = sess.access_token

      // Seks uavhengige kall — ingen av dem trenger resultatet fra de andre,
      // kun accessToken/user.id (allerede kjent her). Kjøres parallelt via
      // Promise.allSettled i stedet for sekvensielt: et mislykket kall skal
      // ikke blokkere de andre fra å vise sitt resultat, og brukeren skal ikke
      // se profilbar → premium-merke → plassering → osv. dukke opp én og én.

      const loadProfile = async () => {
        // Hent profildata (display_name, avatar) client-side
        const { data: prof, error: profError } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .maybeSingle()
        if (profError) console.error('[leaderboard] profile fetch error:', profError.code, profError.message)
        setProfile(prof)
        setDisplayName(prof?.display_name ?? user.email?.split('@')[0] ?? null)
        setAvatarUrl(null)
      }

      const loadSoloPlacement = async () => {
        // Hent brukerens eksakte plassering server-side (også om utenfor topp 50)
        try {
          const soloMe = await fetch(`/api/leaderboard/${quizId}?is_team=false&limit=1${orgSlug ? `&org=${encodeURIComponent(orgSlug)}` : ''}`, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.ok ? r.json() : null)
          if (soloMe?.userEntry) setServerUserSolo({ ...entryToAttempt(soloMe.userEntry, quizId), rank: soloMe.userEntry.rank, isTied: false })
          if (typeof soloMe?.totalCount === 'number') setSoloTotal(soloMe.totalCount)
        } catch { /* ikke kritisk */ }
      }

      const loadLeagueFriends = async () => {
        // Hent ligamedlemmer for "Blant venner"-fane.
        //
        // Feil er ikke tomt (lib/fetch-result.ts) — samme grep som browseError
        // lenger opp i fila. Fram til 31. august 2026 sto ligastatusen i en
        // useState(false), og BÅDE en kastet feil OG en !ok-status (som ikke
        // engang treffer catch-en under) etterlot den false. Da forsvant
        // «Blant venner»-fanen samtidig som CTA-en «Opprett en liga (Premium)»
        // tentes — en bruker som HAR ligaer fikk solgt noe hun allerede hadde.
        // fetchResult skiller de to utfallene; lib/league-affordance.ts avgjør
        // hva hver av dem skal vise.
        const leaguesLoaded = await fetchResult(
          () => fetch('/api/leagues', { headers: { Authorization: `Bearer ${accessToken}` } }),
          json => ((json as { leagues?: { id: string }[] } | null)?.leagues ?? []),
        )
        setLeaguesState(leaguesLoaded.ok ? { ok: true, value: leaguesLoaded.value.length > 0 } : { ok: false })
        // Ligavennene under er en TILLEGGSHENTING: feiler den, står ligastatusen
        // over uansett fast. Uten svar på selve ligalista har vi ingen id-er å
        // slå opp medlemmer for, så da er det ingenting å prøve på.
        if (!leaguesLoaded.ok) return
        const leagues = leaguesLoaded.value
        try {
          const memberResponses = await Promise.all(
            leagues.map(l =>
              fetch(`/api/leagues/${l.id}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
              }).then(r => r.ok ? r.json() : null)
            )
          )
          const userIds = new Set<string>()
          for (const res of memberResponses) {
            for (const m of (res?.members ?? []) as { user_id: string }[]) {
              userIds.add(m.user_id)
            }
          }
          if (userIds.size > 0) {
            const { data: friendProfiles } = await supabaseData
              .from('profiles')
              .select('display_name')
              .in('id', [...userIds])
            setFriendNames(new Set(
              (friendProfiles ?? [])
                .map((p: { display_name: string | null }) => p.display_name)
                .filter((n): n is string => !!n)
            ))
          }
        } catch { /* ikke kritisk */ }
      }

      const loadDuelStatus = async () => {
        // Hent duell-status for "Utfordre"-knapp i leaderboard-rader
        try {
          const rivalRes = await fetch('/api/rivalries/my', {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          if (rivalRes.ok) {
            const rivalJson = await rivalRes.json()
            const rows: { status: string; isChallenger: boolean; opponentId: string; isExpired: boolean }[] = rivalJson.rivalries ?? []
            // Only non-expired active/pending duels are "engagements" that block new challenges.
            // Fix 4: declined duels must not block — challenger is free to start a new duel.
            const engagedRows = rows.filter(r => !r.isExpired && r.status !== 'declined')
            setActiveDuelExists(engagedRows.length > 0)
            // Build a Set of ALL opponent IDs in active engagements (both challenger and rival sides)
            setDuelInvolvedSet(new Set(engagedRows.map(r => r.opponentId)))
            // Still track outgoing-pending separately to show "Sendt" label
            setChallengeSentSet(new Set(
              engagedRows.filter(r => r.status === 'pending' && r.isChallenger).map(r => r.opponentId)
            ))
          }
        } catch { /* ikke kritisk */ }
      }

      await Promise.allSettled([
        loadProfile(),
        loadSoloPlacement(),
        loadLeagueFriends(),
        loadDuelStatus(),
      ])
    }
    } finally {
      // ENESTE sted authLoading slås av. Står i finally nettopp fordi de fire
      // kallene over kan kaste utenfor sin egen catch (allSettled kaster ikke,
      // men setState-kallene og getSessionIdentity kan).
      setAuthLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug])

  useEffect(() => {
    loadSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const newIdentity = getSessionIdentity(newSession)
      if (newIdentity === lastSessionIdentityRef.current) return
      loadSession()
    })
    return () => subscription.unsubscribe()
  }, [loadSession])

  // Re-sjekk premium-status når siden blir synlig igjen (håndterer fanebytte
  // og Next.js router-cache som gjenbruker gammel React-tilstand etter navigasjon).
  // Bevisst resjekk — rutes nå gjennom context sin refreshProfile() (tvungen
  // fersk server-sjekk, null-safe, nedgraderer aldri). Samme oppførsel som før.
  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return
      refreshProfile()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [refreshProfile])

  // Fix 3: clean up challengeError timer on unmount to prevent state update on unmounted component
  useEffect(() => {
    return () => {
      if (challengeErrorTimerRef.current) clearTimeout(challengeErrorTimerRef.current)
    }
  }, [])

  // Escape-lukking og scroll-lås for utfordre-bekreftelsen ligger nå i selve
  // DuelChallengeModal, slik at alle tre inngangene til duell får dem — ikke
  // bare denne siden. Den lokale useEffect-en her er derfor fjernet.

  useEffect(() => {
    if (prevRankMap.size === 0 || attempts.length === 0) return
    const currentRanked = rankAttempts(attempts)
    let best: { name: string; improvement: number } | null = null
    for (const a of currentRanked) {
      const prevRank = prevRankMap.get(a.user_id ?? a.player_name)
      if (prevRank !== undefined) {
        const improvement = prevRank - a.rank
        if (improvement > 0 && (!best || improvement > best.improvement)) {
          best = { name: a.player_name, improvement }
        }
      }
    }
    setMostImprovedName(best?.name ?? null)
  }, [prevRankMap, attempts])

  useEffect(() => {
    if (!scrollPending) return
    const el = document.getElementById('user-row')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setScrollPending(false)
    }
  }, [scrollPending])

  // Nullstill browse-modus ved fanebytte
  useEffect(() => {
    setBrowseMode(false)
    setBrowsePage(1)
    setBrowseSearchInput('')
    setBrowseSearch('')
    setBrowseData(null)
    setBrowseError(false)
  }, [activeTab])

  // Debounce søkefelt → browseSearch. Tomt søk på side 1 = tilbake til klassisk.
  useEffect(() => {
    const t = setTimeout(() => {
      const v = browseSearchInput.trim()
      setBrowseSearch(v)
      setBrowsePage(1)
      if (v !== '') setBrowseMode(true)
      else if (browsePage === 1) setBrowseMode(false)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseSearchInput])

  // Hent browse-data (Premium paginering/søk) for "Alle"/"Lag"
  useEffect(() => {
    if (!browseMode) return
    if (activeTab !== 'alle') return
    let cancelled = false
    setBrowseLoading(true)
    // Nytt forsøk (side, søk eller retry-knapp): feilen viker for en synlig
    // «prøver»-tilstand (Laster…), ikke for ingenting — lib/retry-affordance.ts.
    setBrowseError(false)
    const headers: Record<string, string> = {}
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    let url = `/api/leaderboard/${quizId}?is_team=false&page=${browsePage}`
    if (browseSearch) url += `&search=${encodeURIComponent(browseSearch)}`
    if (orgSlug) url += `&org=${encodeURIComponent(orgSlug)}`
    fetch(url, { headers })
      // Feil er ikke tomt: !ok kastes hit til catch i stedet for å kollapse
      // til null — null ble lest som «Ingen resultater.» i renderBrowseList.
      .then(r => { if (!r.ok) throw new Error(`browse-listen svarte ${r.status}`); return r.json() })
      .then(j => { if (!cancelled) setBrowseData({ entries: j.entries ?? [], totalCount: j.totalCount ?? 0, userRank: j.userRank ?? null }) })
      .catch(() => { if (!cancelled) setBrowseError(true) })
      .finally(() => { if (!cancelled) setBrowseLoading(false) })
    return () => { cancelled = true }
  // Hele session-OBJEKTET som dep er trygt HER, i motsetning til /premium,
  // /bedrift/success og org/[slug]/velkommen: beskyttelsen bor hos SKRIVEREN,
  // ikke i dep-lista. `loadSession` er eneste sted som setter `session`, og
  // onAuthStateChange kaller den kun når getSessionIdentity faktisk har endret
  // seg (lastSessionIdentityRef) — så samme logiske sesjon gir aldri to ULIKE
  // referanser. Vurdert 12. august 2026 og bevisst latt stå; effekten er
  // dessuten gatet på browseMode, som er av ved mount.
  }, [browseMode, activeTab, browsePage, browseSearch, quizId, session, orgSlug, browseAttempt])

  // Activate podium animation when quiz is closed and data is loaded
  useEffect(() => {
    if (!quiz || loading) return
    const closed = isQuizClosed(quiz.closes_at, Date.now())
    if (closed && attempts.length > 0) {
      const t = setTimeout(() => setPodiumActive(true), 50)
      return () => clearTimeout(t)
    }
  }, [quiz, loading, attempts])

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch {}
    setSession(null)
    setDisplayName(null)
    setAvatarUrl(null)
  }

  const handleChallenge = async (rivalId: string) => {
    if (!session) return
    setChallengeLoadingId(rivalId)
    setChallengeError(null)
    try {
      const res = await fetch('/api/rivalries', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rival_id: rivalId }),
      })
      if (res.ok) {
        setChallengeSentSet(prev => new Set([...prev, rivalId]))
        setDuelInvolvedSet(prev => new Set([...prev, rivalId]))
        setActiveDuelExists(true)
      } else {
        // inline error instead of alert()
        const json = await res.json().catch(() => ({}))
        const msg = json.error ?? 'Noe gikk galt.'
        setChallengeError({ rivalId, message: msg })
        // Fix 3: store timer in ref so it can be cancelled on unmount
        if (challengeErrorTimerRef.current) clearTimeout(challengeErrorTimerRef.current)
        challengeErrorTimerRef.current = setTimeout(() => setChallengeError(null), 3000)
      }
    } catch {
      setChallengeError({ rivalId, message: 'Noe gikk galt.' })
      if (challengeErrorTimerRef.current) clearTimeout(challengeErrorTimerRef.current)
      challengeErrorTimerRef.current = setTimeout(() => setChallengeError(null), 3000)
    }
    setChallengeLoadingId(null)
  }

  const formatTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#1a1c23', padding: '40px 20px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SkeletonCard rows={2} showHeader style={{ height: 110 }} />
        <SkeletonCard rows={10} showHeader />
      </div>
    </div>
  )

  // Tilbake-lenka er ikke pynt: dette er ENDESTASJONEN for en quiz som er
  // skjult i admin (is_active = false). RLS-policyen quizzes_select_active gir
  // klienten null rader, .single() feiler med PGRST116, og siden landet her
  // uten noen vei videre fram til 24. august 2026. Samme utvei som
  // show_leaderboard-grenen rett under allerede hadde.
  //
  // MERK, ikke rørt i denne runden: teksten skiller ikke «quizen er skjult»
  // (PGRST116, ingen rader) fra en ekte nettverksfeil, og kaller derfor det
  // første «Noe gikk galt». Feilkoden ligger på e1 og kunne skilt dem — egen sak.
  if (!quiz) return (
    <div style={{ ...s.centered, flexDirection: 'column', gap: 16 }}>
      <p style={s.centeredText}>
        {fetchError ? 'Kunne ikke laste resultatene.' : 'Fant ikke quizen.'}
      </p>
      {fetchError && (
        /* En ekte retry, ikke en beskjed om å laste siden på nytt: nuller
           paritetsnøkkelen (ellers kortslutter effektens vakt et forsøk med
           samme identitet), eier loading selv (samme form som retry-knappen i
           app/arkiv/page.tsx) og re-kjører henteeffekten via fetchAttempt. */
        <button
          onClick={() => {
            listFetchKeyRef.current = null
            setFetchError(false)
            setLoading(true)
            setFetchAttempt(n => n + 1)
          }}
          style={s.retryBtn}
        >
          Prøv igjen
        </button>
      )}
      <Link href="/" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>← Tilbake til forsiden</Link>
    </div>
  )

  if (!quiz.show_leaderboard) return (
    <div style={{ ...s.centered, flexDirection: 'column', gap: 16 }}>
      <p style={s.centeredText}>Resultatene er ikke aktivert for denne quizen.</p>
      <Link href="/" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>← Tilbake til forsiden</Link>
    </div>
  )

  // Beregn attempts og brukerens rad FØR hasPlayed/isHidden — hasPlayed trenger userAttempt
  const soloAttempts = rankAttempts(attempts)
  const friendAttempts = rankAttempts(attempts.filter(a => friendNames.has(a.player_name)))
  // Org-modus skjuler de globale/liga-elementene — org-opplevelsen holdes adskilt.
  // Fanen følger LIGAMEDLEMSKAP, ikke om venner tilfeldigvis er i den hentede
  // lista: fram til 24. august 2026 krevde den friendAttempts.length > 0, og
  // siden lista er trappekuttet (topp 10 gratis / topp 50 Premium) forsvant
  // fanen stille for en ligabruker hvis venner lå utenfor vinduet.
  // Fanen OG CTA-en avgjøres av ÉN funksjon, fordi de er to utfall av samme
  // ukjente: hvor mange ligaer brukeren er med i. Fram til 31. august 2026 leste
  // de hver sin side av den samme false-en, og en feilet henting slo derfor ut
  // begge veier samtidig — fanen forsvant og oppsalget tentes. Se
  // lib/league-affordance.ts.
  const leagueAffordance = decideLeagueAffordance({
    leagues: leaguesState,
    loggedIn: !!session,
    orgMode: !!orgSlug,
    authLoading,
  })
  const showVennerTab = leagueAffordance.showFriendsTab
  // Lista klienten filtrerer venner ut av er kuttet server-side — når kuttet
  // faktisk er i effekt, skal venner-fanen SI det i stedet for å late som
  // utvalget er komplett. soloTotal er eksakt for innloggede (kun gjeste-rank
  // bandes i API-et), så sammenligningen er presis.
  const vennerWindowCut = soloTotal > soloAttempts.length
  const totalCount = soloTotal

  const currentUserId = session?.user?.id ?? null
  // Finn i den lastede topp-50, ellers fall tilbake til server-beregnet plassering
  const userSoloAttempt = (currentUserId
    ? soloAttempts.find(a => a.user_id === currentUserId) ?? null
    : displayName ? soloAttempts.find(a => a.player_name === displayName) ?? null : null)
    ?? serverUserSolo
  const userAttempt = userSoloAttempt

  // hasPlayed: sjekk BÅDE localStorage (savedResult) OG at forsøket finnes i leaderboard-data
  // Dette håndterer tilfellet der bruker spilte på annen enhet (savedResult = null)
  const hasPlayed = !!savedResult || !!userAttempt
  // ── Hva løfter skjulingen (29. august 2026) ────────────────────────────────
  // Var `isPremium && hasPlayed`. Premium-leddet falt bort — den som har levert
  // er ferdig, og trappen (P-1) gir innlogget gratis topp 10. Begrunnelsen i
  // sin helhet står ved `viewerHasOwnRow` i app/api/leaderboard/[id]/route.ts.
  //
  // `hasPlayed` er BEVISST IKKE inndataen her, selv om den betyr «har spilt» og
  // brukes til alt annet på siden. Den er `!!savedResult || !!userAttempt`, og
  // `savedResult` er localStorage — forfalskbart på ett sekund i konsollen. Så
  // lenge leddet også krevde Premium var det ufarlig; alene ville en forfalsket
  // `qk_result_`-nøkkel vippet grenen for hvem som helst. Ingen data lekker
  // (serveren er porten og sender `entries: []` uansett), men siden ville falt
  // til «Ingen resultater ennå» der låseskjermen skal stå — en usann tom
  // tilstand, samme klasse feil som 8242bf6 rettet.
  //
  // `userAttempt` er derimot serverens eget svar tilbake: den er raden fra
  // `entries` eller `serverUserSolo`, som begge kommer fra `userEntry` — altså
  // nøyaktig serverens `mine`. `!!session` foran, fordi bare en innlogget
  // kaller har en JWT-verifisert identitet serveren kan svare `mine` på; en
  // gjest med lagret resultat skal fortsatt vente (hun kan ikke skilles fra en
  // som aldri spilte).
  //
  // `(!orgSlug || isPremium)` speiler serverens org-gate og MÅ stå: uten den
  // ville et gratis org-medlem som har spilt fått listegrenen mot et tomt
  // `entries`. Premium-leddet står der fordi org-rommet beholder DAGENS regel
  // — utvidelsen legger til en gruppe nasjonalt, den bytter ikke ut en i org.
  // Faller org-unntaket bort på serveren en dag, skal det falle her i samme
  // runde.
  //
  // SAMME funksjon som serverruten bruker for å tømme entries — de to kan ikke
  // lenger konkludere ulikt om samme quiz (B1, NONNULL-sveipet 26. august 2026).
  const isHidden = decideHiddenUntilClosed({
    hideUntilClosed: quiz.hide_leaderboard_until_closed,
    closesAt: quiz.closes_at,
    viewerHasOwnRow: !!session && !!userAttempt && (!orgSlug || isPremium),
    now: Date.now(),
  })

  const fastestSoloName = soloAttempts.length > 0
    ? soloAttempts.reduce((f, a) => a.total_time_ms < f.total_time_ms ? a : f).player_name
    : null

  // Delt mellom attemptToRow (klassisk topp-50-visning) og browseEntryToRow
  // (Premium søk/paginering) — se lib/duel-affordance.ts. Kartleggingen
  // 28. juli viste at browse-modus aldri fikk denne logikken da
  // tabellformatet ble innført 26. juli, så "Utfordre" manglet helt for
  // rader utenfor topp 50 (paginert visning).
  const duelState = { currentUserId, duelInvolvedIds: duelInvolvedSet, challengeSentIds: challengeSentSet, activeDuelExists, challengeLoadingId }

  // Ren mapper — erstatter den tidligere renderRow (som rendret et kort-format
  // <div> direkte). All logikk under er UENDRET fra originalen (merke-utregning,
  // navn/kallenavn/medlemsnr-sammenslåing, klikkbarhets-gating); kun repakket
  // som objektfelt for ResultsTable i stedet for JSX. Avatar er droppet (se
  // designbeslutning 26. juli); merket flyttes inn i Navn-cellen via
  // ResultsTable sin `badge`-støtte i stedet for å ligge på et avatar-hjørne.
  const attemptToRow = (attempt: RankedAttempt, isUser: boolean, showLiveNote: boolean, rowClassName?: string): ResultsTableRow => {
    const shownName = attempt.user_id
      ? (memberInfoMap.get(attempt.user_id)?.display_name ?? attempt.player_name)
      : attempt.player_name
    const shownNickname = attempt.user_id ? (memberInfoMap.get(attempt.user_id)?.nickname ?? null) : null
    const hasNick = !!shownNickname?.trim()
    const line1 = hasNick ? shownNickname!.trim() : shownName

    let badge: BadgeKind | null = null
    if (attempt.rank === 1) badge = 'krone'
    else if (attempt.player_name === mostImprovedName) badge = 'pil'
    else if ((attempt.correct_streak ?? 0) >= 5) badge = 'flamme'
    else if (attempt.player_name === fastestSoloName) badge = 'lyn'
    else if (attempt.rank <= 3) badge = 'medalje'

    const memberNo = attempt.user_id && memberInfoMap.get(attempt.user_id)?.show_member_number
      ? memberInfoMap.get(attempt.user_id)?.member_number ?? null
      : null
    const secondaryParts = [
      memberNo != null ? '#' + String(memberNo).padStart(3, '0') : null,
      hasNick ? shownName : null,
    ].filter(Boolean) as string[]

    // H2H Duell er gratis for alle innloggede, på alle rader unntatt egen —
    // uendret regel fra originalen.
    // isSelf beregnes UAVHENGIG av `isUser` (som er premium-gatet, kun brukt
    // til highlight-styling) — uten dette fikk en free-bruker hvis egen rad
    // havnet i topp-N sin egen rad markert klikkbar, fordi isUser da alltid
    // var false og dermed aldri traff eksklusjonen under.
    const isSelf = currentUserId
      ? attempt.user_id === currentUserId
      : !!displayName && attempt.player_name === displayName
    const { clickable, alreadySent } = computeDuelAffordance(attempt.user_id, isSelf, duelState)
    const trailingLabel = alreadySent ? 'Sendt' : null

    return {
      key: attempt.user_id ?? attempt.id,
      rank: attempt.rank,
      // Gjester har verken kallenavn eller medlemsnr (ingen konto), så
      // secondaryParts er alltid tom for dem — "(guest)" flettes derfor rett
      // inn på navnelinja i stedet for å kreve et eget felt for én sjelden,
      // ikke-klikkbar radtype.
      name: attempt.user_id ? line1 : `${line1} (guest)`,
      secondary: secondaryParts.length > 0 ? secondaryParts.join(' · ') : null,
      correctAnswers: attempt.correct_answers,
      totalTimeMs: attempt.total_time_ms,
      highlight: isUser,
      tied: attempt.isTied,
      badge,
      clickable,
      trailingLabel,
      clickHint: clickable ? 'Utfordre' : null,
      ariaLabel: clickable ? `Utfordre ${line1} til duell` : null,
      note: (attempt.user_id && challengeError?.rivalId === attempt.user_id)
        ? { text: challengeError.message, tone: 'error' }
        : showLiveNote
          ? { text: `${soloTotal} spillere har spilt så langt — oppdateres gjennom dagen`, tone: 'muted' }
          : null,
      separatorLabel: null,
      rowClassName,
    }
  }

  // sectionTotal: tallet i tellerchippen. Trappen gjør at `ranked` bare er
  // radene kallerens trinn fikk (3/10/50) — for «Enkeltpersoner» sendes derfor
  // serverens totalCount inn, så chippen ikke påstår at feltet er 3 stort.
  const renderSection = (ranked: RankedAttempt[], label: string, visibleCount: number, onShowMore: () => void, isPodium = false, sectionTotal?: number) => {
    if (ranked.length === 0) return null
    const visible = ranked.slice(0, visibleCount)
    const userInSection = currentUserId
      ? ranked.find(a => a.user_id === currentUserId) ?? null
      : displayName ? ranked.find(a => a.player_name === displayName) ?? null : null
    const userOutsideVisible = userInSection && userInSection.rank > visibleCount
    const remaining = ranked.length - visibleCount

    const podiumClass = (rank: number): string | undefined => {
      if (!isPodium || !podiumActive) return undefined
      if (rank === 1) return 'podium-row-1'
      if (rank === 2) return 'podium-row-2'
      if (rank === 3) return 'podium-row-3'
      return 'podium-rest'
    }

    const rows: ResultsTableRow[] = visible.map(attempt => {
      const isUserRow = isPremium && (currentUserId ? attempt.user_id === currentUserId : attempt.player_name === displayName)
      return attemptToRow(attempt, isUserRow, isUserRow && !isClosed, podiumClass(attempt.rank))
    })
    // «Din plassering»: brukerens egen rad føyes til SAMME tabell (ikke en
    // andre tabell-instans) med en separator-etikett rett over — matcher
    // hvordan org-admin allerede fremhever «meg» via highlight, kombinert med
    // en synlig divider ResultsTable rendrer som en egen full-bredde rad.
    if (userOutsideVisible && isPremium) {
      const placementRow = attemptToRow(userInSection, true, !isClosed)
      rows.push({ ...placementRow, separatorLabel: '— Din plassering —' })
    }

    return (
      <div key={label}>
        <div style={s.sectionHeader}>
          <span style={s.sectionText}>{label}</span>
          <div style={s.sectionLine} />
          <span style={s.sectionCount}>{sectionTotal ?? ranked.length}</span>
        </div>
        <ResultsTable
          rows={rows}
          totalQuestions={ranked[0]?.total_questions}
          formatTime={formatTime}
          onRowClick={row => setPendingChallenge({ id: row.key, name: row.name })}
        />
        {remaining > 0 && (
          <button style={s.btnMore} onClick={onShowMore}>
            Vis {Math.min(10, remaining)} til
          </button>
        )}
      </div>
    )
  }

  // ── Premium browse-modus (paginering/søk) for "Alle"/"Lag" ────────────────
  const roomTotal    = soloTotal
  // suppressOwnPublicRank: «Gå til min plassering (#N)» viser det offentlige
  // tallet og skal ikke tilbys blokkerte — knappen forsvinner når ranken er null.
  const roomUserRank = suppressOwnPublicRank ? null : (userSoloAttempt?.rank ?? null)
  const userInBrowse = !!(currentUserId && browseData?.entries.some(e => e.userId === currentUserId))
  const browseSearching = browseMode && browseSearch.trim() !== ''
  const showBrowseControls = isPremium && activeTab === 'alle' && (roomTotal > 10 || browseMode)
  const showJumpToMeBrowse = showBrowseControls && roomUserRank != null && !userInBrowse && !browseSearching
  // Låst variant for gratis (22. august 2026): kontrollene fantes ikke i det
  // hele tatt uten Premium — nå vises ÉN rad i søkefeltets posisjon, med
  // lås-badge og /premium som mål (b2ba244-mønsteret). Speiler
  // showBrowseControls-betingelsene; profileLoading-vakten hindrer at raden
  // blinker for Premium før profilen er lastet.
  const showLockedBrowseControls = !profileLoading && !isPremium && activeTab === 'alle' && roomTotal > 10

  function browsePageWindow(current: number, total: number): (number | 'gap')[] {
    const wanted = [...new Set([1, 2, current - 1, current, current + 1, total - 1, total])]
      .filter(n => n >= 1 && n <= total)
      .sort((a, b) => a - b)
    const out: (number | 'gap')[] = []
    let prev = 0
    for (const n of wanted) {
      if (prev && n - prev > 1) out.push('gap')
      out.push(n)
      prev = n
    }
    return out
  }

  function goToMyPlacementBrowse() {
    if (roomUserRank == null) return
    setBrowseMode(true)
    setBrowsePage(Math.max(1, Math.ceil(roomUserRank / BROWSE_PAGE_SIZE)))
    setScrollPending(true)
  }

  function renderBrowseControls() {
    if (!showBrowseControls) {
      if (!showLockedBrowseControls) return null
      // Én diskret rad, ikke tre døde kontroller — badgen er markeringen,
      // raden selv er outline i søkefeltets form.
      return (
        <Link href="/premium" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 14, color: '#e8e4dd', textDecoration: 'none', fontFamily: "var(--font-instrument-sans), sans-serif", background: 'transparent' }}>
          <span>Søk og bla blant alle {roomTotal} spillere</span>
          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#c9a84c', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)', borderRadius: 999, padding: '2px 8px' }}>
            Premium
          </span>
        </Link>
      )
    }
    const tc = browseData?.totalCount ?? 0
    return (
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          value={browseSearchInput}
          onChange={e => setBrowseSearchInput(e.target.value)}
          placeholder="Søk etter navn…"
          style={{ width: '100%', boxSizing: 'border-box', background: 'transparent', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#e8e4dd', fontFamily: "var(--font-instrument-sans), sans-serif", outline: 'none' }}
        />
        {showJumpToMeBrowse && (
          <button
            onClick={goToMyPlacementBrowse}
            style={{ marginTop: 10, background: 'transparent', color: '#e8e4dd', border: '1px solid #e8e4dd', borderRadius: 10, padding: '10px 28px', fontSize: 14, fontWeight: 600, fontFamily: "var(--font-instrument-sans), sans-serif", cursor: 'pointer', width: 'auto' }}
          >
            Gå til min plassering (#{roomUserRank})
          </button>
        )}
        {browseSearching && (
          <p style={{ fontSize: 12, color: '#918f8a', marginTop: 8 }}>
            {tc === 0
              ? `Ingen treff på «${browseSearch}».`
              : tc > BROWSE_PAGE_SIZE
                ? `Viser de ${BROWSE_PAGE_SIZE} første av ${tc} treff. Forsøk et mer spesifikt søk.`
                : `${tc} treff.`}
          </p>
        )}
      </div>
    )
  }

  // Premium søk/paginering manglet merker fra dag én (uendret, bevisst) —
  // MEN manglet også utfordre-knappen ved en glipp: da tabellformatet ble
  // innført 26. juli fikk denne mapperen aldri computeDuelAffordance-kallet
  // som attemptToRow har, så "Utfordre" forsvant for alle rader utenfor
  // topp 50 (funnet 28. juli via paginering til rad 61-71). Rettet ved å
  // gjenbruke samme delte logikk som attemptToRow, i stedet for en tredje
  // kopi av betingelsene.
  function browseEntryToRow(e: LbEntry): ResultsTableRow {
    const isSelf = currentUserId != null && e.userId === currentUserId
    const shownName = e.userId ? (memberInfoMap.get(e.userId)?.display_name ?? e.playerName) : e.playerName
    const shownNickname = e.userId ? (e.nickname ?? memberInfoMap.get(e.userId)?.nickname ?? null) : null
    const hasNick = !!shownNickname?.trim()
    const line1 = hasNick ? shownNickname!.trim() : shownName
    const { clickable, alreadySent } = computeDuelAffordance(e.userId, isSelf, duelState)
    const trailingLabel = alreadySent ? 'Sendt' : null
    return {
      // user_id foretrekkes (matcher attemptToRow) — pendingChallenge.id
      // sendes videre som rival_id og må være en bruker-id, ikke attempt-id.
      key: e.userId ?? e.id,
      rank: e.rank,
      name: e.userId ? line1 : `${line1} (guest)`,
      secondary: hasNick ? shownName : null,
      correctAnswers: e.correctAnswers,
      totalTimeMs: e.totalTimeMs,
      highlight: isSelf,
      badge: null,
      clickable,
      trailingLabel,
      clickHint: clickable ? 'Utfordre' : null,
      ariaLabel: clickable ? `Utfordre ${line1} til duell` : null,
      note: (e.userId && challengeError?.rivalId === e.userId)
        ? { text: challengeError.message, tone: 'error' }
        : null,
    }
  }

  function renderBrowseList() {
    // Feilet henting FØR tom-grenene: «Ingen resultater.» er en faktapåstand
    // og skal kun stå når serveren faktisk svarte med en tom liste.
    if (browseError) {
      return (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <p style={{ fontSize: 13, color: '#e8e4dd', marginBottom: 10 }}>Kunne ikke hente resultatene.</p>
          <button onClick={() => setBrowseAttempt(n => n + 1)} style={s.retryBtn}>Prøv igjen</button>
        </div>
      )
    }
    if (browseLoading && !browseData) {
      return <p style={{ fontSize: 13, color: '#918f8a', fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>Laster…</p>
    }
    const entries = browseData?.entries ?? []
    if (entries.length === 0) {
      return <p style={s.tabEmpty}>{browseSearching ? `Ingen treff på «${browseSearch}».` : 'Ingen resultater.'}</p>
    }
    return (
      <>
        <div style={s.sectionHeader}>
          <span style={s.sectionText}>Enkeltpersoner</span>
          <div style={s.sectionLine} />
          <span style={s.sectionCount}>{browseData?.totalCount ?? entries.length}</span>
        </div>
        <ResultsTable
          rows={entries.map(browseEntryToRow)}
          totalQuestions={entries[0]?.totalQuestions}
          formatTime={formatTime}
          onRowClick={row => setPendingChallenge({ id: row.key, name: row.name })}
        />
      </>
    )
  }

  function renderBrowsePagination() {
    if (!showBrowseControls || browseSearching) return null
    const totalPages = Math.max(1, Math.ceil(roomTotal / BROWSE_PAGE_SIZE))
    if (totalPages <= 1) return null
    if (!browseMode && roomTotal <= 50) return null   // klassisk "vis til" dekker ≤50
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 16 }}>
        {browsePageWindow(browsePage, totalPages).map((p, i) =>
          p === 'gap'
            ? <span key={`g${i}`} style={{ color: '#918f8a', padding: '6px 4px', fontSize: 12 }}>…</span>
            : <button
                key={p}
                onClick={() => { setBrowsePage(p); setBrowseMode(true) }}
                style={{ background: p === browsePage ? 'rgba(201,168,76,0.12)' : 'transparent', border: `1px solid ${p === browsePage ? '#c9a84c' : '#2a2d38'}`, color: p === browsePage ? '#c9a84c' : '#e8e4dd', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: "var(--font-instrument-sans), sans-serif", cursor: 'pointer', whiteSpace: 'nowrap' as const }}
              >
                {`${(p - 1) * BROWSE_PAGE_SIZE + 1}–${Math.min(p * BROWSE_PAGE_SIZE, roomTotal)}`}
              </button>
        )}
      </div>
    )
  }

  const isClosed = quiz ? isQuizClosed(quiz.closes_at, Date.now()) : false

  // Org-kontekst: matcher slug-en mot brukerens org-medlemskap (allerede lastet
  // i loadSession). Gir org-navn til header uten ekstra kall.
  const orgContext = orgSlug ? userOrgs.find(o => o.orgSlug === orgSlug) ?? null : null
  // Én kilde for BEGGE org-linjene i headeren. De to kan derfor ikke motsi
  // hverandre, og ingen av dem kan motsi lista de står over.
  const orgNotice = decideOrgScopeNotice({ requestedOrg: orgSlug, servedOrg: servedOrgSlug })

  return (
    <>
      <style>{podiumStyles}</style>
      <AuthModal open={showModal} onClose={() => setShowModal(false)} />
      {/* Utfordre-bekreftelse — trigges av trykk på en klikkbar rad. Delt
          komponent (components/DuelChallengeModal.tsx) med duell-forslagene
          på quiz-resultatskjermen, slik at begge inngangene til H2H Duell
          bruker nøyaktig samme bekreftelsesflyt. */}
      <DuelChallengeModal
        pending={pendingChallenge}
        onCancel={() => setPendingChallenge(null)}
        onConfirm={id => { setPendingChallenge(null); handleChallenge(id) }}
      />
      <SiteNav
        variant={orgSlug ? 'org' : 'default'}
        orgSlug={orgSlug ?? undefined}
        quizId={quiz?.id}
        backQuery={cameFromHistory ? '?hist=1' : undefined}
      />
      <div style={s.wrap}>
        <div style={s.page}>

          <header style={s.header}>
            <p style={s.eyebrow}>{orgContext?.orgName ?? 'Quizkanonen'}</p>
            <h1 style={s.title}>Quiz<em style={s.titleEm}>kanonen</em></h1>
            <p style={s.subtitle}>{quiz.title}</p>
            {orgNotice === 'colleagues' && (
              <p style={{ fontSize: 13, color: '#918f8a', marginTop: 8 }}>
                Resultater blant kollegene dine
              </p>
            )}
            {/* Org-scopet falt bort fordi sesjonsoppslaget ikke svarte innen
                spinner-budsjettet. To tilfeller, avgjort 19. august 2026:

                1. Sesjonen har LANDET i etterkant (fornyelsen lyktes, bare
                   sent) og myOrgs bekrefter medlemskapet i orgSlug: byttet
                   TILBYS som knapp. Lista bytter aldri populasjon under en
                   som leser — klikket i knappen er det eneste som utløser
                   den scopede hentingen (via decideFetchScope).
                2. Ellers: linja må si hvilken liste som FAKTISK vises —
                   ellers leser brukeren den nasjonale toppen som kollegenes.
                   Blir betingelsene aldri sanne, står denne som i dag. */}
            {orgNotice === 'degraded' && (
              session?.access_token && orgContext ? (
                <div style={{ marginTop: 12 }}>
                  <button
                    onClick={() => setOrgScopeUpgradeRequested(true)}
                    disabled={orgScopeUpgradeRequested}
                    style={{
                      background: 'transparent', color: '#e8e4dd',
                      fontFamily: "var(--font-instrument-sans), sans-serif",
                      fontSize: 13, fontWeight: 600, padding: '10px 28px',
                      border: '1px solid #2a2d38', borderRadius: 10,
                      cursor: orgScopeUpgradeRequested ? 'default' : 'pointer',
                      opacity: orgScopeUpgradeRequested ? 0.6 : 1,
                    }}
                  >
                    {orgScopeUpgradeRequested
                      ? 'Henter kollegene dine …'
                      : 'Vi fant bedriften din — vis kollegene'}
                  </button>
                </div>
              ) : (
                <p style={{ fontSize: 14, color: '#e8e4dd', marginTop: 8, lineHeight: 1.6 }}>
                  Vi fikk ikke bekreftet bedriftstilhørigheten din akkurat nå, så
                  dette er den nasjonale topplisten.{' '}
                  <button
                    onClick={() => window.location.reload()}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      font: 'inherit', color: '#e8e4dd', textDecoration: 'underline',
                    }}
                  >
                    Prøv igjen
                  </button>
                </p>
              )
            )}
            <div style={s.rule} />
          </header>

          {/* Profile bar */}
          {!authLoading && session && (() => {
            const barName =
              (session.user.id ? memberInfoMap.get(session.user.id)?.display_name : null)
              ?? profile?.display_name
              ?? displayName
            return (
              <div style={s.profileBar}>
                <div style={s.avatar}>
                  {avatarUrl
                    ? <img src={avatarUrl} alt="" width={34} height={34} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : getAvatarInitial(barName)
                  }
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>{barName}</p>
                  <p style={{ fontSize: 11, color: '#918f8a', marginTop: 1 }}>Innlogget</p>
                </div>
                <button onClick={handleSignOut} style={s.btnOutline}>Logg ut</button>
              </div>
            )
          })()}

          {/* Hero result card — vises når bruker har spilt */}
          {(hasPlayed || userAttempt) && (() => {
            const correctAnswers = userAttempt?.correct_answers ?? savedResult?.correct_answers ?? null
            const totalQ = userAttempt?.total_questions ?? null
            const timeMs = userAttempt?.total_time_ms ?? savedResult?.total_time_ms ?? null
            const rank = isPremium && userAttempt && !suppressOwnPublicRank ? userAttempt.rank : null
            const streak = userAttempt?.correct_streak ?? null
            const scorePct = correctAnswers != null && totalQ != null ? Math.round(correctAnswers / totalQ * 100) : null
            const hasStats = rank != null || timeMs != null || scorePct != null || (streak != null && streak > 0)

            return (
              <div style={{ background: '#21242e', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 20, marginBottom: 12 }}>
                {/* qk-lb-result-wrap: kolonne på mobil, rad på desktop */}
                <div className="qk-lb-result-wrap" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>

                  {/* Score-seksjon */}
                  {correctAnswers != null && (
                    <div>
                      <p style={{ fontFamily: "var(--font-libre-baskerville), serif", fontWeight: 700, color: '#ffffff', lineHeight: 1, marginBottom: 3 }}>
                        <span className="qk-lb-hero-score" style={{ fontSize: 52 }}>{correctAnswers}</span>
                        {totalQ != null && <span className="qk-lb-score-label" style={{ fontSize: 22, color: '#918f8a', fontWeight: 400 }}> av {totalQ}</span>}
                      </p>
                      <p style={{ fontSize: 11, color: '#918f8a', letterSpacing: '0.12em', textTransform: 'uppercase' as const, fontWeight: 600 }}>riktige svar</p>
                    </div>
                  )}

                  {/* Meta-rad: plassering + statistikk */}
                  {hasStats && (
                    <div className="qk-lb-meta-row" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const, justifyContent: 'center' }}>
                      {rank != null && (
                        <span style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 18, fontWeight: 700, color: '#c9a84c', whiteSpace: 'nowrap' as const }}>
                          Plass {rank} av {totalCount}
                        </span>
                      )}
                      {/* «Begge tall» for org-medlemmer som deltar åpent — det
                          interne i tillegg til det offentlige, aldri i stedet. */}
                      {rank != null && !orgSlug && placementDisplay.mode === 'both'
                        && internalSolo?.rank != null && internalSolo.total > 0 && (
                        <span style={{ fontSize: 13, color: '#e8e4dd', whiteSpace: 'nowrap' as const }}>
                          {internalSolo.rank}. av {internalSolo.total} hos dere
                        </span>
                      )}
                      {timeMs != null && (
                        <div style={{ textAlign: 'center' as const }}>
                          <p style={{ fontSize: 15, fontWeight: 700, color: '#e8e4dd', fontFamily: "var(--font-instrument-sans), sans-serif" }}>{formatTime(timeMs)}</p>
                          <p style={{ fontSize: 10, color: '#918f8a', marginTop: 1, textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 600 }}>Tid</p>
                        </div>
                      )}
                      {scorePct != null && (
                        <div style={{ textAlign: 'center' as const }}>
                          <p style={{ fontSize: 15, fontWeight: 700, color: '#e8e4dd', fontFamily: "var(--font-instrument-sans), sans-serif" }}>{scorePct}%</p>
                          <p style={{ fontSize: 10, color: '#918f8a', marginTop: 1, textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 600 }}>Score</p>
                        </div>
                      )}
                      {streak != null && streak > 0 && (
                        <div style={{ textAlign: 'center' as const }}>
                          <p style={{ fontSize: 15, fontWeight: 700, color: '#e8e4dd', fontFamily: "var(--font-instrument-sans), sans-serif" }}>{streak}</p>
                          <p style={{ fontSize: 10, color: '#918f8a', marginTop: 1, textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: 600 }}>Streak</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Prosentil — utledet fra rank/totalCount som allerede er lastet over, ingen nytt kall */}
                  {rank != null && totalCount > 1 && (
                    <p style={{ fontSize: 12, color: '#918f8a' }}>
                      Bedre enn {Math.round(((totalCount - rank) / (totalCount - 1)) * 100)}% av deltakerne
                    </p>
                  )}

                </div>
              </div>
            )
          })()}

          {/* ── Org-svaret feilet: plasseringen er ikke borte, den er uavklart ──
              suppressOwnPublicRank tømmer fem flater på denne siden (hero-rank,
              persentil, delingstall, «Gå til min plassering», gratis-kortet).
              Er årsaken 'unknown' PLUSS en feilet henting, retter det seg aldri
              selv — se shouldOfferPlacementRetry i lib/placement-visibility.ts.
              Plassert her, rett under hero-kortet, fordi det er der tallet
              skulle stått. Krever hasPlayed: uten et resultat er det ingen
              plassering å savne. ── */}
          {!authLoading && session && hasPlayed && (() => {
            // Samme mellomtilstand som resultatskjermen i app/quiz/[id] —
            // begge gates på myOrgsError, og begge forsvant i klikkøyeblikket
            // fram til 19. august 2026. Se lib/retry-affordance.ts.
            const retry = shouldOfferPlacementRetry({ mode: placementDisplay.mode, myOrgsError })
              ? describeRetry({ failed: myOrgsError, refreshing: myOrgsRefreshing })
              : 'hidden'
            if (retry === 'hidden') return null
            return (
            <p style={{ fontSize: 14, color: '#e8e4dd', textAlign: 'center', marginBottom: 12, lineHeight: 1.6 }}>
              Vi fikk ikke hentet plasseringen din akkurat nå.{' '}
              <button
                onClick={() => { void refreshMyOrgs() }}
                disabled={retry === 'pending'}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  cursor: retry === 'pending' ? 'default' : 'pointer',
                  font: 'inherit', color: '#e8e4dd',
                  textDecoration: retry === 'pending' ? 'none' : 'underline',
                }}
              >
                {retry === 'pending' ? 'Prøver igjen …' : 'Prøv igjen'}
              </button>
            </p>
            )
          })()}

          {/* Del-knapp — innloggede brukere som har spilt */}
          {!authLoading && session && hasPlayed && (() => {
            const shareCorrect = userAttempt?.correct_answers ?? savedResult?.correct_answers ?? null
            const shareTotalQ  = userAttempt?.total_questions ?? null
            // Blokkerte deler den plasseringsløse varianten under — intern
            // plassering er meningsløs utad og røper org-tilhørighet.
            const shareRank    = isPremium && userAttempt && !suppressOwnPublicRank ? userAttempt.rank : null
            if (shareCorrect == null) return null
            const shareText = shareRank != null && shareTotalQ != null
              ? `Jeg fikk ${shareCorrect}/${shareTotalQ} og havnet på ${shareRank}. av ${totalCount} på Quizkanonen! 🎯`
              : shareTotalQ != null
              ? `Jeg fikk ${shareCorrect}/${shareTotalQ} på Quizkanonen! 🎯`
              : `Jeg fikk ${shareCorrect} riktige på Quizkanonen! 🎯`

            async function handleShare() {
              if (navigator.share) {
                await navigator.share({ text: shareText }).catch(() => {/* avbrutt */})
              } else {
                await navigator.clipboard.writeText(shareText).catch(() => {})
                setShareCopied(true)
                setTimeout(() => setShareCopied(false), 2500)
              }
            }

            const challengeUrl = `https://www.quizkanonen.no/utfordring?fra=${encodeURIComponent(displayName ?? 'En spiller')}&quiz=${quiz?.id ?? ''}`
            const challengeText = `${displayName ?? 'En spiller'} utfordrer deg på ukens Quizkanonen! Kan du slå meg? 🎯`

            async function handleChallenge() {
              if (navigator.share) {
                await navigator.share({ text: challengeText, url: challengeUrl }).catch(() => {/* avbrutt */})
              } else {
                await navigator.clipboard.writeText(`${challengeText}\n${challengeUrl}`).catch(() => {})
                setChallengeCopied(true)
                setTimeout(() => setChallengeCopied(false), 2500)
              }
            }

            return (
              <div style={{ textAlign: 'center', marginBottom: 12, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handleShare}
                  style={{
                    background: 'transparent',
                    border: '1px solid #2a2d38',
                    color: shareCopied ? '#4ade80' : '#e8e4dd',
                    fontFamily: "var(--font-instrument-sans), sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '10px 24px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}
                >
                  {shareCopied ? 'Kopiert!' : 'Del resultatet ditt'}
                </button>
                <button
                  onClick={handleChallenge}
                  style={{
                    background: 'transparent',
                    border: '1px solid #2a2d38',
                    color: challengeCopied ? '#4ade80' : '#e8e4dd',
                    fontFamily: "var(--font-instrument-sans), sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '10px 24px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}
                >
                  {challengeCopied ? 'Lenke kopiert!' : 'Utfordre en venn'}
                </button>
              </div>
            )
          })()}

          {/* ── Kort for den som IKKE er autentisert akkurat nå ────────────────
              HVEM er dette? Ikke en gjestespiller. `qk_result_` skrives
              UBETINGET i finishQuiz (app/quiz/[id]/page.tsx), også for
              innloggede, så grenene med `savedResult` treffer en RETUR-SPILLER:
              noen som spilte innlogget, og som nå mangler sesjon fordi hen
              logget ut (knappen står på denne siden), fordi sesjonen løp ut,
              eller fordi getSession() brukte opp spinner-budsjettet (SESSION_CHECK_MS) og siden falt til
              anonym visning.

              Målt 24. august 2026, ikke antatt: prod har 625 forsøk og NULL med
              user_id = null. Gjeste-veien står teknisk åpen, men ingen har
              noensinne brukt den. Grenene ble skrevet 2. april og 21. mai 2026,
              da «ikke innlogget» naturlig ble lest som «gjest» — derav den
              gamle teksten «logg inn for å spille under ditt eget navn», som ba
              en retur-spiller gjøre noe hen allerede hadde gjort.

              STENGT QUIZ er derfor en egen gren i alle tre tilfellene: den
              gamle teksten lovet spilling på en quiz som er over, og
              «plasseringen din vises når flere har levert» var direkte usant —
              ingen flere kommer til å levere. ── */}
          {!authLoading && !session && totalCount > 0 && (() => {
            // Vis kun plasserings-estimat hvis det finnes et lagret forsøk.
            // Uten et er "plass 1 og 9" villedende — vis en nøytral CTA i stedet.
            let title: string
            let sub: string
            if (savedResult && totalCount >= 10) {
              // Samme gate som plasseringskortet i app/quiz/[id]/page.tsx: under
              // 10 deltakere spenner «estimatet» hele feltet («mellom plass 1 og
              // N av N») og leser som en ødelagt funksjon. Nøytral ventetekst i
              // stedet — se kommentaren ved showSpan der.
              //
              // Server-beregnet (bandet) estimat foretrekkes: trappen gjør at en
              // gjest kun ser topp 3, så det lokale «tell bedre rader»-estimatet
              // under er systematisk for godt for alle utenfor toppen. Det står
              // igjen kun som siste utvei når liste-kallet feilet.
              const { correct_answers, total_time_ms } = savedResult
              const allRanked = soloAttempts
              const better = allRanked.filter(a =>
                a.correct_answers > correct_answers ||
                (a.correct_answers === correct_answers && a.total_time_ms < total_time_ms)
              ).length
              const est = serverGuestRank ?? better + 1
              const tierStart = Math.floor((est - 1) / 10) * 10 + 1
              const rangeX = Math.max(1, tierStart)
              const rangeY = Math.min(totalCount, tierStart + 9)
              title = `Du er et sted mellom plass ${rangeX} og ${rangeY}`
              // «igjen»: hen spilte allerede under sitt eget navn. Og eksakt
              // plassering er trygt å love her — forsøket ligger på kontoen.
              sub = isClosed
                ? 'Logg inn igjen for å se topp 10 og den eksakte plasseringen din.'
                : 'Logg inn for å spille under ditt eget navn'
            } else if (savedResult) {
              title = isClosed
                ? 'For få deltakere til å anslå en plassering'
                : 'Du er blant de første som har spilt denne uken'
              sub = isClosed
                ? 'Logg inn igjen for å se topp 10.'
                : 'Plasseringen din vises når flere har levert — logg inn for å spille under ditt eget navn.'
            } else {
              // Ingen lagret score: en fremmed uten forsøk. Er quizen stengt,
              // kan hen ikke spille den — da er topp 10 den ekte gevinsten ved
              // å logge inn, ikke et løfte om å spille.
              title = isClosed ? 'Logg inn for å se topp 10' : 'Logg inn og spill quizen'
              sub = isClosed
                ? 'Denne quizen er stengt. Neste kommer fredag.'
                : 'Se hvor du havner i ukens resultater.'
            }
            return (
              <div style={s.card}>
                <div style={s.cardRow}>
                  <div>
                    <p style={s.cardTitle}>{title}</p>
                    <p style={s.cardSub}>{sub}</p>
                  </div>
                  <button onClick={() => setShowModal(true)} style={s.btnGold}>
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      <path d="M19.6 10.23c0-.7-.063-1.39-.182-2.05H10v3.878h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232C18.344 15.925 19.6 13.27 19.6 10.23z" fill="#4285F4"/>
                      <path d="M10 20c2.7 0 4.964-.896 6.618-2.424l-3.232-2.51c-.896.6-2.042.955-3.386.955-2.604 0-4.81-1.758-5.598-4.12H1.064v2.592A9.996 9.996 0 0 0 10 20z" fill="#34A853"/>
                      <path d="M4.402 11.901A6.02 6.02 0 0 1 4.09 10c0-.662.113-1.305.312-1.901V5.507H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.493l3.338-2.592z" fill="#FBBC05"/>
                      <path d="M10 3.98c1.468 0 2.786.504 3.822 1.496l2.868-2.868C14.959.992 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.507l3.338 2.592C5.19 5.738 7.396 3.98 10 3.98z" fill="#EA4335"/>
                    </svg>
                    Logg inn med Google
                  </button>
                </div>
              </div>
            )
          })()}

          {/* Placement card for free logged-in users who have played — åpen ELLER
              stengt quiz (P-1: spennet er gratis-løftet fra /slik-fungerer-det,
              og gratis ser nå kun topp 10 i listen). Vilkåret (inkl.
              suppressOwnPublicRank-gaten for blokkerte — dette kortet var den
              femte og siste egen-plassering-flaten på siden som manglet den)
              bor i lib/placement-visibility.ts, testdekket. */}
          {shouldShowFreePlacementCard({
            authLoading,
            hasSession: !!session,
            isPremium,
            hasPlayed,
            totalCount,
            suppressOwnPublicRank,
          }) && (() => {
            let rangeX = 1
            let rangeY = Math.min(10, totalCount)
            // Foretrekk server-beregnet plassering; fall tilbake til lokalt estimat
            const estRank = userSoloAttempt?.rank ?? null
            if (estRank != null) {
              const tierStart = Math.floor((estRank - 1) / 10) * 10 + 1
              rangeX = Math.max(1, tierStart)
              rangeY = Math.min(totalCount, tierStart + 9)
            } else if (savedResult) {
              const { correct_answers, total_time_ms } = savedResult
              const allRanked = soloAttempts
              const better = allRanked.filter(a =>
                a.correct_answers > correct_answers ||
                (a.correct_answers === correct_answers && a.total_time_ms < total_time_ms)
              ).length
              const est = better + 1
              const tierStart = Math.floor((est - 1) / 10) * 10 + 1
              rangeX = Math.max(1, tierStart)
              rangeY = Math.min(totalCount, tierStart + 9)
            }
            // Samme gate som gjestekortet over og som app/quiz/[id]/page.tsx.
            const showSpan = totalCount >= 10
            return (
              <div style={s.card}>
                {showSpan ? (
                  <p style={s.cardTitle}>Du er et sted mellom plass {rangeX} og {rangeY}</p>
                ) : (
                  // SØSKEN til det anonyme kortet over: «plasseringen din vises
                  // når flere har levert» er usant på en STENGT quiz — ingen
                  // flere kommer til å levere. Ble nåbar her først 23. august
                  // 2026, da isClosed-gaten ble fjernet fra
                  // shouldShowFreePlacementCard (P-1 steg 3) slik at spennet
                  // også står etter stenging. Fanget 24. august.
                  <p style={{ ...s.cardTitle, lineHeight: 1.5 }}>
                    {isClosed
                      ? 'For få deltakere til å anslå en plassering.'
                      : 'Du er blant de første som har spilt denne uken — plasseringen din vises når flere har levert.'}
                  </p>
                )}
                <p style={{ fontSize: 13, color: '#918f8a', marginTop: 4 }}>
                  Se nøyaktig plassering —{' '}
                  <a href="/premium" style={{ color: '#e8e4dd', textDecoration: 'none' }}>
                    få Premium
                  </a>
                </p>
              </div>
            )
          })()}

          {isHidden ? (
            // Tre utfall, ikke to — se decideHiddenLeaderboardView i
            // lib/leaderboard-visibility.ts. 'nothing' er den ekte
            // lastetilstanden (uendret); 'locked' er låseskjermen som før
            // (uendret tekst); 'waiting' er den som manglet: en innlogget
            // gratisbruker SOM HAR SPILT fikk tom luft, fordi hasPlayed lå i
            // samme ledd som authLoading.
            (() => {
              const hiddenView = decideHiddenLeaderboardView({ authLoading, hasPlayed })
              if (hiddenView === 'nothing') return null
              if (hiddenView === 'locked') return (
                <div style={s.empty}>
                  <div style={{ ...s.emptyIcon, fontSize: undefined }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5">
                      <rect x="3" y="11" width="18" height="11" rx="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </div>
                  <p style={s.emptyTitle}>Spill quizen for å se resultatene</p>
                  <p style={s.emptySub}>
                    Resultatene er kun synlige for de som har spilt.<br />
                    Publiseres for alle når quizen stenger.
                  </p>
                  <Link href={`/quiz/${quizId}`} style={s.btnLink}>Spill quizen →</Link>
                </div>
              )
              // 'waiting'. Klokkeslettet leses av quiz.closes_at, aldri
              // hardkodet: stengetiden er per quiz, og en org-quiz kan ha en
              // annen. Formateringen går via osloClosingTime — ingen rå
              // `new Date` på en quiz-dato her, samme NONNULL-regel som toppen
              // av filen. NULL er formelt uoppnåelig (decideHiddenUntilClosed
              // returnerer false på NULL, så vi står ikke her), men setningen
              // faller uansett tilbake på en uten klokkeslett.
              // Ikonet er en KLOKKE, ikke hengelåsen over: hun er ikke stengt
              // ute, hun venter. En lås her ville motsagt setningen under seg.
              const stengetid = osloClosingTime(quiz.closes_at)
              return (
                <div style={s.empty}>
                  <div style={{ ...s.emptyIcon, fontSize: undefined }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9"/>
                      <path d="M12 7v5l3 2"/>
                    </svg>
                  </div>
                  <p style={s.emptyTitle}>Resultatet ditt er registrert</p>
                  <p style={s.emptySub}>
                    Listen holdes skjult mens quizen pågår, så den ikke røper noe for dem som ikke har spilt ennå.<br />
                    {stengetid
                      ? `Den publiseres for alle når quizen stenger kl. ${stengetid}.`
                      : 'Den publiseres for alle når quizen stenger.'}
                  </p>
                  <Link href="/premium" style={s.btnLink}>Se listen nå med Premium →</Link>
                </div>
              )
            })()
          ) : attempts.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyIcon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#918f8a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
              <p style={s.emptyTitle}>Ingen resultater ennå</p>
              <p style={s.emptySub}>Vær den første til å fullføre denne quizen.</p>
              <Link href={`/quiz/${quizId}`} style={s.btnLink}>Spill quizen →</Link>
            </div>
          ) : (
            <>
              <div style={s.tabRow}>
                <button
                  style={activeTab === 'alle' || !showVennerTab ? s.tabActive : s.tabInactive}
                  onClick={() => setActiveTab('alle')}
                >
                  Alle
                </button>
                {showVennerTab && (
                  <button
                    style={activeTab === 'venner' ? s.tabActive : s.tabInactive}
                    onClick={() => setActiveTab('venner')}
                  >
                    Blant venner
                  </button>
                )}
              </div>

              {/* Merke-legende — flyttet til toppen 26. juli 2026 (lå tidligere
                  under listen): brukeren skal forstå symbolene FØR de skummer
                  radene, ikke etter. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 14 }}>
                {([
                  { badge: 'krone', label: 'Leder' },
                  // P-1 (23. august 2026): nasjonalt leverer prev-rank-ruten nå
                  // kun kallerens EGEN forrige plassering, så merket kan bare
                  // lande på ens egen rad — «Størst fremgang» ville vært en
                  // superlativ over et felt vi ikke lenger ser. Org-modus har
                  // fortsatt hele kartet, og der er superlativen sann.
                  //
                  // Utelatt helt for utloggede (24. august 2026): prev-rank
                  // svarer `{}` uten token, så merket KAN ikke tegnes for dem —
                  // og «Din fremgang» til en som ikke har noen er ren støy.
                  ...(orgSlug || session
                    ? [{ badge: 'pil', label: orgSlug ? 'Størst fremgang' : 'Din fremgang' }]
                    : []),
                  { badge: 'flamme', label: 'Streak 5+' },
                  { badge: 'lyn', label: 'Raskest' },
                  { badge: 'medalje', label: 'Topp 3' },
                ] as { badge: BadgeKind; label: string }[]).map(({ badge, label }) => (
                  <span key={badge} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#e8e4dd' }}>
                    <BadgeCircle badge={badge} size={14} />
                    {label}
                  </span>
                ))}
              </div>

              {/* Hint for trykk-på-rad-mønsteret — vises kun for innloggede,
                  siden det er nøyaktig samme betingelse utfordre-funksjonen
                  alltid har krevd. Vist én gang, ikke duplisert i begge faner. */}
              {session && (
                <p style={{ fontSize: 12, color: '#918f8a', textAlign: 'center', margin: '0 0 14px' }}>
                  Trykk på en deltaker for å utfordre til duell.
                </p>
              )}

              {/* !showVennerTab-fallbacken: forsvinner fanen mens den står valgt
                  (utlogging, org-bytte), skal «Alle»-innholdet overta — ellers
                  ble en faneløs venner-visning stående igjen. */}
              {(activeTab === 'alle' || !showVennerTab) && (
                <>
                  {renderBrowseControls()}
                  {browseMode
                    ? renderBrowseList()
                    : renderSection(soloAttempts, 'Enkeltpersoner', visibleSoloCount, () => setVisibleSoloCount(c => c + 10), isClosed, soloTotal)}
                  {renderBrowsePagination()}
                </>
              )}

              {activeTab === 'venner' && showVennerTab && (
                friendAttempts.length > 0
                  ? (
                    <>
                      {vennerWindowCut && (
                        <p style={{ fontSize: 12, color: '#918f8a', textAlign: 'center', margin: '0 0 14px' }}>
                          Viser bare ligavenner blant de {soloAttempts.length} øverste på lista.
                        </p>
                      )}
                      {renderSection(friendAttempts, 'Blant venner', visibleVennerCount, () => setVisibleVennerCount(c => c + 10))}
                    </>
                  )
                  : (
                    <p style={s.tabEmpty}>
                      {/* Klienten kan ikke skille «ikke spilt» fra «spilt, men utenfor
                          topp N» når lista er kuttet — påstå det bare når hele lista
                          faktisk er lastet. */}
                      {vennerWindowCut
                        ? `Her vises bare ligavenner blant de ${soloAttempts.length} øverste på lista. Ingen av dine er der ennå.`
                        : 'Ingen ligavenner har spilt denne quizen ennå.'}
                    </p>
                  )
              )}
            </>
          )}

          {/* Liga CTA for innloggede som er BEKREFTET uten ligaer — skjult i
              org-modus, og skjult når ligahentingen ikke svarte. */}
          {leagueAffordance.showLeagueCta && (
            <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13 }}>
              Vil du konkurrere mot vennene dine?{' '}
              <Link href="/liga" style={{ color: '#e8e4dd', textDecoration: 'none' }}>Opprett en liga (Premium) →</Link>
            </p>
          )}

          {/* Svarfordeling — kun etter at quiz er stengt, kun innlogget Premium.
              Var tidligere helt åpen (fasit + prosent for ALLE spørsmål,
              synlig for anonyme besøkende) — strammet inn 26. juli 2026. */}
          {isClosed && (
            <div style={{ marginTop: 32 }}>
              <div style={s.sectionHeader}>
                <span style={s.sectionText}>Svarfordeling</span>
                <div style={s.sectionLine} />
                {session && isPremium && (
                  <button
                    onClick={async () => {
                      if (!showAnswerDist && !answerDist && !answerDistPremiumRequired) {
                        setAnswerDistLoading(true)
                        try {
                          const res = await fetch(`/api/quiz/${quizId}/answer-distribution`, {
                            headers: { Authorization: `Bearer ${session.access_token}` },
                          })
                          if (res.ok) {
                            const d = await res.json()
                            setAnswerDist({ easiest: d.easiest ?? [], hardest: d.hardest ?? [] })
                          } else if (res.status === 403) {
                            setAnswerDistPremiumRequired(true)
                          }
                        } catch { /* stille */ } finally {
                          setAnswerDistLoading(false)
                        }
                      }
                      setShowAnswerDist(v => !v)
                    }}
                    style={{ background: 'none', border: '1px solid #2a2d38', borderRadius: 8, padding: '4px 12px', fontSize: 11, fontWeight: 600, color: '#e8e4dd', cursor: 'pointer', fontFamily: "var(--font-instrument-sans), sans-serif", whiteSpace: 'nowrap' }}
                  >
                    {showAnswerDist ? 'Skjul' : 'Vis'}
                  </button>
                )}
              </div>

              {/* ÉN gren for alle som ikke har tilgang (24. august 2026).
                  Utloggede fikk tidligere «Logg inn for å se svarfordeling» —
                  et løfte som ikke holdt: svarfordeling er PREMIUM, så hun
                  logget inn og møtte en ny vegg. To trinn, to skuffelser.
                  Nå får utlogget og innlogget-gratis nøyaktig samme, sanne
                  kort. /premium er verifisert tilgjengelig utlogget (200, full
                  side) og sier selv «Du må være innlogget for å kjøpe», så
                  innloggingstrinnet er dekket der det hører hjemme. */}
              {!session || !isPremium ? (
                <div style={s.card}>
                  <p style={s.cardTitle}>Se svarfordelingen for ukens letteste og vanskeligste spørsmål</p>
                  <p style={{ fontSize: 13, color: '#918f8a', marginTop: 4 }}>
                    <a href="/premium" style={{ color: '#e8e4dd', textDecoration: 'none' }}>Bli Premium</a>
                  </p>
                </div>
              ) : showAnswerDist && (
                answerDistLoading
                  ? <p style={{ fontSize: 13, color: '#918f8a', fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>Laster…</p>
                  : answerDist && (answerDist.easiest.length > 0 || answerDist.hardest.length > 0)
                    ? (['easiest', 'hardest'] as const).map(group => {
                        const list = answerDist[group]
                        if (list.length === 0) return null
                        return (
                          <div key={group} style={{ marginBottom: 18 }}>
                            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 10 }}>
                              {group === 'easiest' ? 'To letteste' : 'To vanskeligste'}
                            </p>
                            {list.map(q => (
                              <div key={q.questionId} style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px 22px', marginBottom: 10 }}>
                                <p style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 15, fontWeight: 700, color: '#ffffff', marginBottom: 4, lineHeight: 1.4 }}>
                                  {q.questionText}
                                </p>
                                <p style={{ fontSize: 11, color: '#918f8a', marginBottom: 12 }}>
                                  {q.correctPct}% svarte riktig
                                </p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  {q.distribution.map(d => {
                                    const isCorrect = q.correctAnswers.includes(d.option)
                                    return (
                                      <div key={d.option}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                          <span style={{ fontSize: 11, fontWeight: 700, color: isCorrect ? '#c9a84c' : '#918f8a', width: 14, flexShrink: 0 }}>{d.option}</span>
                                          <span style={{ fontSize: 13, color: isCorrect ? '#e8e4dd' : '#918f8a', flex: 1, lineHeight: 1.3 }}>{d.label}</span>
                                          <span style={{ fontSize: 12, fontWeight: 700, color: isCorrect ? '#c9a84c' : '#918f8a', flexShrink: 0 }}>{d.percent}%</span>
                                        </div>
                                        <div style={{ height: 6, background: '#2a2d38', borderRadius: 3, overflow: 'hidden' }}>
                                          <div style={{ height: '100%', width: `${d.percent}%`, background: isCorrect ? '#c9a84c' : '#3a3d48', borderRadius: 3, transition: 'width 0.4s ease' }} />
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                                {q.totalAnswers > 0 && (
                                  <p style={{ fontSize: 11, color: '#918f8a', marginTop: 12, textAlign: 'right' }}>
                                    {q.totalAnswers} svar
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      })
                    : <p style={{ fontSize: 13, color: '#918f8a', fontStyle: 'italic', textAlign: 'center', padding: '16px 0' }}>Ingen svardata tilgjengelig.</p>
              )}
            </div>
          )}

          {/* Neste steg */}
          <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #2a2d38', textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: '#918f8a', marginBottom: 14, letterSpacing: '0.04em' }}>
              Neste quiz kommer fredag
            </p>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
              {!authLoading && session && (
                <Link href="/historikk" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                  Se din quizhistorikk →
                </Link>
              )}
              {/* Org-/liga-modus: lenk til riktig scopet toppliste i stedet
                  for den nasjonale. cameFromHistory (?hist=1, satt av
                  SeasonLeaderboard sin "Tidligere quizer"-lenke) tar
                  brukeren rett tilbake til den ÅPNE historikk-fanen i
                  stedet for "Siste quiz". */}
              {orgSlug ? (
                <Link href={`/org/${orgSlug}${cameFromHistory ? '?hist=1' : ''}`} style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                  Se bedriftstopplisten →
                </Link>
              ) : leagueSlug ? (
                <Link href={`/liga/${leagueSlug}${cameFromHistory ? '?hist=1' : ''}`} style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                  Se liga-topplisten →
                </Link>
              ) : (
                <Link href={`/toppliste${cameFromHistory ? '?hist=1' : ''}`} style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                  Se sesong-topplisten →
                </Link>
              )}
            </div>
          </div>

          {/* Kontekstuell navigasjon — kun for innloggede, skjult i org-modus */}
          {!authLoading && session && !orgSlug && (userOrgs.length > 0) && (
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #2a2d38', textAlign: 'center' }}>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 12 }}>
                Se også
              </p>
              <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link href="/toppliste" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                  Nasjonal toppliste →
                </Link>
                {userOrgs.map(org => (
                  <Link key={org.orgSlug} href={`/org/${org.orgSlug}`} style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>
                    {org.orgName} →
                  </Link>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
