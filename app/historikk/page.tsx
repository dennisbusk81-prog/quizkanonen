'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { hasSettledPlays } from '@/lib/has-settled-plays'
import { decideHero, decideRecords, pickBesteResultat } from '@/lib/historikk-oversikt'
import type { FieldProgress } from '@/lib/field-relative-progress'
import type { HistoryAttempt, PlayerStats } from '@/lib/history'
import SiteNav from '@/components/SiteNav'
import SkeletonCard from '@/components/SkeletonCard'
import ErrorBoundary from '@/components/ErrorBoundary'
import KategoriTall from '@/components/KategoriTall'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('no-NO', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('no-NO', {
    day: 'numeric', month: 'short',
  })
}

function scorePct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

// Progresjonsteksten kommer nå ferdig formulert fra serveren
// (lib/field-relative-progress.ts). Her lå tidligere `toProgMsg`, som gjorde om
// en rå prosentdifferanse til «Du har blitt 11% dårligere de siste 4 ukene» —
// en setning som i praksis beskrev hvor vanskelige quizene tilfeldigvis var.

// ─── Styles ───────────────────────────────────────────────────────────────────

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', backgroundColor: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd', flexGrow: 1 },
  page:     { maxWidth: 680, margin: '0 auto', padding: '0 20px 60px' },

  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#918f8a', fontStyle: 'italic' as const },

  back:     { display: 'inline-block', fontSize: 12, color: '#e8e4dd', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' },

  // Hero section
  hero:         { padding: '16px 0 12px', textAlign: 'center' as const },
  heroEyebrow:  { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#918f8a', marginBottom: 4 },
  heroNum:      { fontFamily: "'Libre Baskerville', serif", fontSize: 64, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 4 },
  heroNumLabel: { fontSize: 12, color: '#918f8a', letterSpacing: '0.06em', marginBottom: 10 },
  // `lineHeight` og `maxWidth` er ikke pynt: underteksten var før en kort
  // tallinje («7 quizer spilt · snitt 62%»), men bærer nå hele setninger på opp
  // mot 65 tegn. På mobil brekker de over to–tre linjer, og uten linjeavstand
  // klumper de seg. maxWidth holder linjelengden lesbar på desktop.
  heroSub:      { fontSize: 13, color: '#918f8a', lineHeight: 1.5, maxWidth: 420, margin: '0 auto' },
  heroRule:     { width: '100%', height: 1, background: '#2a2d38', marginTop: 12 },

  // Graph card — progresjon msg inside
  graphCard:    { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '16px 20px 10px', marginBottom: 10, marginTop: 10 },
  graphHeader:  { marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' as const },
  graphLabel:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#918f8a' },

  // Forklaring til de to linjene. Uten den er den grå linja et uforklart
  // element. Swatchene er linjeprøver i samme farge som kurvene de beskriver,
  // ikke egne fargeflater — gull-swatchen er den samme gull-linja, ikke et
  // nytt gull-element.
  legend:           { display: 'flex', alignItems: 'center', gap: 12 },
  legendItem:       { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#918f8a' },
  legendSwatchDeg:  { display: 'inline-block', width: 12, height: 2, background: '#c9a84c', borderRadius: 1 },
  legendSwatchFelt: { display: 'inline-block', width: 12, height: 0, borderTop: '1.5px dashed #918f8a' },
  progPositive: { marginTop: 8, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 500, background: 'rgba(76,175,77,0.08)', border: '1px solid rgba(76,175,77,0.2)', color: '#4caf7d' },
  progNegative: { marginTop: 8, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 500, background: 'rgba(201,76,76,0.08)', border: '1px solid rgba(201,76,76,0.2)', color: '#c94c4c' },
  progNeutral:  { marginTop: 8, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 500, background: 'rgba(106,104,96,0.1)', border: '1px solid #2a2d38', color: '#918f8a' },
  // `graphEmpty` er fjernet sammen med tom-tilstanden den stylet («Spill flere
  // quizer for å se utviklingen din»). Kortet skjules nå helt under to quizer.

  featuredLbl:  { fontSize: 11, fontWeight: 600, color: '#918f8a', marginBottom: 2 },
  featuredCtx:  { fontSize: 10, color: '#918f8a', lineHeight: 1.4 },

  // Rekorder — én rad per rekord, verdien til høyre. Radform framfor et
  // rutenett av tall: hver rekord bærer sin egen kontekst («13 av 15 ·
  // Fredagsquiz 24.07»), og kontekst trenger bredde, ikke en rute.
  //
  // Tallene her er HVITE, ikke gull. Heroen er sidens ene gull-element øverst;
  // et rekordkort i gull rett under ville gitt to gull-flater på samme skjerm.
  recCard:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '20px', marginBottom: 10 },
  recHeader:    { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#918f8a', marginBottom: 14 },
  recRow:       { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '9px 0' },
  recRowFirst:  { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '0 0 9px' },
  recLbl:       { fontSize: 12, color: '#918f8a', flexShrink: 0 },
  recVal:       { fontSize: 13, fontWeight: 600, color: '#ffffff', textAlign: 'right' as const, minWidth: 0 },
  recDivider:   { height: 1, background: '#2a2d38' },

  catRow:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 },
  catCard:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '16px 20px' },
  catVal:       { fontFamily: "'Libre Baskerville', serif", fontSize: 22, fontWeight: 700, color: '#c9a84c', lineHeight: 1.2, marginBottom: 4, overflowWrap: 'break-word' as const },
  // Prosent- og antall-linja under kategorinavnet bor i
  // components/KategoriTall.tsx, sammen med vakten som avgjør om den vises.

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#918f8a', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#918f8a', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  // Quiz rows
  rowBase:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, textDecoration: 'none', cursor: 'pointer' as const },
  rowHover: { background: '#252836', border: '1px solid rgba(201,168,76,0.28)', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, textDecoration: 'none', cursor: 'pointer' as const },
  rowLeft:  { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 14, fontWeight: 700, color: '#ffffff', marginBottom: 2, whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const },
  rowMeta:  { fontSize: 11, color: '#918f8a' },
  rowRight: { textAlign: 'right' as const, flexShrink: 0 },
  rowRank:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, fontWeight: 700, color: '#c9a84c', lineHeight: 1, marginBottom: 2 },
  rowScore: { fontSize: 11, color: '#918f8a', marginBottom: 1 },
  rowSub:   { fontSize: 10, color: '#918f8a' },

  btnMore: { width: '100%', padding: '10px 0', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 10, color: '#e8e4dd', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif", marginTop: 6 },

  empty:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '40px 24px', textAlign: 'center' as const, marginTop: 24 },
  emptyIcon:  { fontSize: 36, marginBottom: 12, opacity: 0.5 },
  emptyTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 6 },
  emptySub:   { fontSize: 13, color: '#918f8a', lineHeight: 1.6, marginBottom: 20 },
  btnGold:    { display: 'inline-block', background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 22px', borderRadius: 10, textDecoration: 'none' },
} as const

// ─── Constants ────────────────────────────────────────────────────────────────

const API_PAGE_SIZE = 50

// Skjemaversjon for `sessionStorage`-bufferen under. BUMP DENNE hver gang
// felt legges til eller fjernes i svaret fra /api/historikk.
//
// Bufferen lagrer hele JSON-svaret og leser det tilbake som om det matcher
// dagens PlayerStats-type. Det gjør det ikke: et blob skrevet av forrige
// deploy overlever i fanen, og nye felt er `undefined` i det. 4. august 2026
// ga det «% riktige ( av )» på kategorikortene, og — mer stille —
// `deltakelsesrekke: undefined`, som faller gjennom `> 0` og viser «0 nå» til
// en spiller som har en rekke gående.
//
// Versjonen i NØKKELEN, ikke i verdien: en gammel nøkkel blir da aldri lest,
// i stedet for å bli lest og forkastet.
//   v2 = feltene lagt til 4. august 2026.
//   v3 = 13. august 2026. `progresjon` byttet form fra {type, diff} til ferdig
//        tekst, `felt_snitt_riktige` kom til, og persentilfeltene forsvant. Et
//        v2-blob ville gitt en graf uten feltlinje og ingen progresjonstekst —
//        ikke et krasj, men stille feil data, som er verre.
const CACHE_VERSION = 'v3'

// SVG graph dimensions
const GW = 600
const GH = 160
const GP = { top: 16, right: 16, bottom: 40, left: 40 }

// ─── Score graph ──────────────────────────────────────────────────────────────

type GraphPoint = {
  x: number
  y: number
  score: number
  title: string
  date: string
  /** Feltets snitt på samme quiz, i prosent — null når snittet mangler. */
  feltY: number | null
  feltScore: number | null
}

/**
 * Utviklingskortet. To linjer: spillerens score i gull, feltets snitt i dempet
 * grått.
 *
 * HVORFOR FELTLINJEN FINNES: uten den leses et fall i gull-linja som «jeg ble
 * dårligere». Feltets snitt svinger fra 6,43 til 10,32 riktige av 15 mellom
 * uker i prod, så 17. juli falt ALLE — og med begge linjene tegnet ser man med
 * én gang at de faller sammen.
 *
 * Returnerer null under to punkter: et kort som kun inneholder «spill flere
 * quizer» ser ut som en feil, ikke som en tilstand. Oppfordringen til den nye
 * spilleren ligger i heroens undertekst (lib/historikk-oversikt.ts, B1/B4).
 *
 * ENHETENE ER MED VILJE ULIKE her og i progresjonsteksten: grafen tegner
 * prosent fordi det er den eneste aksen som er sann på tvers av quizer med
 * ulikt antall spørsmål, mens teksten teller riktige svar fordi «prosentpoeng
 * over snittet» er sjargong. Aksemerkene er en skala, ikke en påstand — det er
 * setningen som bærer tallet leseren skal ta med seg.
 */
function ScoreGraph({
  history,
  progMsg,
  feltSnitt,
}: {
  history: HistoryAttempt[]
  progMsg: FieldProgress | null
  feltSnitt: Record<string, number>
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const chrono = [...history]
    .sort((a, b) => new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime())
    .slice(-50)

  const n = chrono.length
  const plotW = GW - GP.left - GP.right
  const plotH = GH - GP.top - GP.bottom

  const getX = (i: number): number =>
    n > 1 ? GP.left + (i / (n - 1)) * plotW : GP.left + plotW / 2
  const getY = (score: number): number =>
    GP.top + (1 - score / 100) * plotH

  const points: GraphPoint[] = chrono.map((a, i) => {
    // Feltsnittet lagres som antall riktige og regnes om her, med RADENS egen
    // total_questions. Det er den eneste nevneren som er sann for nøyaktig den
    // quizen — en hardkodet 15 ville vært et faktum om i dag, ikke om
    // datamodellen.
    const feltRiktige = feltSnitt?.[a.quiz_id]
    const feltScore =
      typeof feltRiktige === 'number' && a.total_questions > 0
        ? Math.round((feltRiktige / a.total_questions) * 100)
        : null
    return {
      x: getX(i),
      y: getY(scorePct(a.correct_answers, a.total_questions)),
      score: scorePct(a.correct_answers, a.total_questions),
      title: a.quiz_title,
      date: formatDateShort(a.completed_at),
      feltY: feltScore !== null ? getY(feltScore) : null,
      feltScore,
    }
  })

  // Under to punkter finnes det ingen utvikling å tegne — kortet skjules helt.
  if (n < 2) return null

  const gridYValues = [0, 50, 100]
  const labelEvery = Math.max(1, Math.ceil(n / 6))

  const linePts = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaBottomY = (GP.top + plotH).toFixed(1)
  const areaPts = [
    `${GP.left.toFixed(1)},${areaBottomY}`,
    ...points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `${(GW - GP.right).toFixed(1)},${areaBottomY}`,
  ].join(' ')

  // Feltlinja tegnes kun over de punktene som FAKTISK har et snitt. Et hull
  // hoppes over i stedet for å trekke en rett strek gjennom det, som ville
  // påstått en måling som ikke finnes.
  const feltPts = points
    .filter((p) => p.feltY !== null)
    .map((p) => `${p.x.toFixed(1)},${(p.feltY as number).toFixed(1)}`)
    .join(' ')
  const harFeltlinje = points.filter((p) => p.feltY !== null).length >= 2

  const TW = 152, TH = 56
  const tooltip = hoveredIdx !== null ? (() => {
    const p = points[hoveredIdx]
    const tx = Math.max(0, Math.min(p.x - TW / 2, GW - TW))
    const ty = p.y < GP.top + 70 ? p.y + 12 : p.y - TH - 8
    const label = p.title.length > 22 ? p.title.slice(0, 20) + '…' : p.title
    return (
      <g style={{ pointerEvents: 'none' }}>
        <rect x={tx} y={ty} width={TW} height={TH} rx={6} fill="#21242e" stroke="#c9a84c" strokeWidth={1} />
        <text x={tx + TW / 2} y={ty + 14} textAnchor="middle" fontSize={10} fill="#918f8a"
          style={{ fontFamily: "'Instrument Sans', sans-serif" }}>{label}</text>
        <text x={tx + TW / 2} y={ty + 31} textAnchor="middle" fontSize={13} fill="#c9a84c"
          style={{ fontFamily: "'Libre Baskerville', serif", fontWeight: 700 }}>
          {p.score}% · {p.date}
        </text>
        {p.feltScore !== null && (
          <text x={tx + TW / 2} y={ty + 46} textAnchor="middle" fontSize={10} fill="#918f8a"
            style={{ fontFamily: "'Instrument Sans', sans-serif" }}>
            Feltet: {p.feltScore}%
          </text>
        )}
      </g>
    )
  })() : null

  const progStyle = progMsg?.variant === 'positive' ? s.progPositive
    : progMsg?.variant === 'negative' ? s.progNegative
    : s.progNeutral

  return (
    <div style={s.graphCard}>
      <div style={s.graphHeader}>
        <span style={s.graphLabel}>Utvikling</span>
        {harFeltlinje && (
          <div style={s.legend}>
            <span style={s.legendItem}>
              <span style={s.legendSwatchDeg} />Deg
            </span>
            <span style={s.legendItem}>
              <span style={s.legendSwatchFelt} />Feltet
            </span>
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${GW} ${GH}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
        {gridYValues.map((v) => (
          <g key={v}>
            <line x1={GP.left} y1={getY(v)} x2={GW - GP.right} y2={getY(v)} stroke="#2a2d38" strokeWidth={1} />
            <text x={GP.left - 6} y={getY(v)} textAnchor="end" dominantBaseline="middle"
              fontSize={9} fill="#918f8a" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>
              {v}%
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          (i % labelEvery === 0 || i === n - 1) ? (
            <text key={i} x={p.x} y={GH - GP.bottom + 14} textAnchor="middle"
              fontSize={9} fill="#918f8a" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>
              {p.date}
            </text>
          ) : null
        )}
        <polygon points={areaPts} fill="rgba(201,168,76,0.06)" stroke="none" />
        {/* Feltlinja tegnes FØR spillerens linje, så gull ligger øverst der de
            krysser — det er spillerens egen kurve leseren følger. */}
        {harFeltlinje && (
          <polyline points={feltPts} fill="none" stroke="#918f8a" strokeWidth={1.5}
            strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />
        )}
        <polyline points={linePts} fill="none" stroke="#c9a84c" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={hoveredIdx === i ? 5 : 3}
            fill={hoveredIdx === i ? '#c9a84c' : '#21242e'} stroke="#c9a84c" strokeWidth={2}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}
        {tooltip}
      </svg>
      {progMsg && <div style={progStyle}>{progMsg.tekst}</div>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'ready' | 'error'

export default function HistorikkPage() {
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [history, setHistory] = useState<HistoryAttempt[]>([])
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null)
  const [historyLocked, setHistoryLocked] = useState(false)

  // Cachen leses KUN i fetch-effekten under, på nøkkelen
  // `qk_historikk_${CACHE_VERSION}_${bruker-id}`.
  //
  // Her lå tidligere en useLayoutEffect som leste cachen før første paint for å
  // unngå skjelett-blink ved tilbakenavigering. Den kunne ikke vite hvem som var
  // innlogget — bruker-id-en finnes først etter `getSession()`, som er async — så
  // den itererte over ALLE `qk_historikk_*`-nøkler og malte den første ferske.
  // Ved brukerbytte i samme fane (delt maskin, familie-PC, testing med to
  // kontoer) betydde det at forrige brukers historikk ble vist til den nye
  // brukeren fram til fetchen rettet det opp. Skjelettet er billigere enn det.
  //
  // Ikke gjeninnfør en pre-paint-lesning uten en synkron, pålitelig bruker-id.

  // Background prefetch: after list is shown, silently cache the 3 most recent
  // attempt details so clicking a row opens instantly.
  useEffect(() => {
    if (loadState !== 'ready' || history.length === 0) return

    const CACHE_TTL = 10 * 60 * 1000
    const toPreload = history.slice(0, 3).filter((attempt) => {
      try {
        const raw = sessionStorage.getItem(`qk_attempt_v2_${attempt.id}`)
        if (!raw) return true
        const cached = JSON.parse(raw) as { fetchedAt: number }
        return Date.now() - cached.fetchedAt >= CACHE_TTL
      } catch { return true }
    })

    if (toPreload.length === 0) return

    let cancelled = false
    const timer = setTimeout(async () => {
      if (cancelled) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session || cancelled) return
        await Promise.allSettled(
          toPreload.map(async (attempt) => {
            try {
              const res = await fetch(`/api/historikk/${attempt.id}`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
              })
              if (!res.ok || cancelled) return
              const data = await res.json()
              if (cancelled) return
              try {
                sessionStorage.setItem(
                  `qk_attempt_v2_${attempt.id}`,
                  JSON.stringify({ fetchedAt: Date.now(), data })
                )
              } catch { /* ignore */ }
            } catch { /* ignore */ }
          })
        )
      } catch { /* ignore */ }
    }, 1000)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [loadState, history])

  useEffect(() => {
    let cancelled = false
    const CACHE_TTL = 5 * 60 * 1000

    async function load() {
      // Retry once if Supabase hasn't initialised session from localStorage yet
      let { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500))
        if (cancelled) return
        const { data } = await supabase.auth.getSession()
        session = data.session
      }

      if (cancelled) return

      if (!session) {
        router.replace('/login?next=/historikk')
        return
      }

      const CACHE_KEY = `qk_historikk_${CACHE_VERSION}_${session.user.id}`

      try {
        const raw = sessionStorage.getItem(CACHE_KEY)
        if (raw) {
          const cached = JSON.parse(raw) as {
            fetchedAt: number
            data: { history: HistoryAttempt[]; stats: PlayerStats; total?: number; pageSize?: number }
          }
          if (Date.now() - cached.fetchedAt < CACHE_TTL) {
            if (!cancelled) {
              const t  = cached.data.total    ?? cached.data.history.length
              const ps = cached.data.pageSize ?? API_PAGE_SIZE
              setHistory(cached.data.history)
              setStats(cached.data.stats)
              setTotal(t)
              setHasMore(cached.data.history.length >= ps && t > cached.data.history.length)
              setLoadState('ready')
            }
            return
          }
        }
      } catch {
        // sessionStorage unavailable — continue to fetch
      }

      const res = await fetch('/api/historikk?page=0', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (cancelled) return

      if (res.status === 403) {
        // Har brukeren spilt noe i det hele tatt? season_scores skrives av
        // processQuiz for ALLE innloggede deltakere, uavhengig av Premium
        // (lib/award-season-points.ts), så et treff her betyr «har spilt minst
        // én gjort opp quiz innlogget» — IKKE «har hatt Premium». Teksten under
        // må derfor ikke påstå en tidligere Premium-tilstand; se kortet i
        // `historyLocked`-grenen.
        //
        // Sjekken bor i lib/has-settled-plays.ts (delt med enkeltforsøk-siden):
        // ALLE scopes — ikke bare 'global', som kastet org-blokkerte brukere
        // (hele Elkjøp) til /premium med full historikk — og 'unknown' ved
        // feil, som vises som låseskjerm, aldri som utkastelse.
        const played = await hasSettledPlays(session.user.id)
        if (played === 'no') {
          router.replace('/premium')
        } else {
          if (!cancelled) { setHistoryLocked(true); setLoadState('ready') }
        }
        return
      }
      if (!res.ok) { if (!cancelled) setLoadState('error'); return }

      const json = await res.json() as { history: HistoryAttempt[]; stats: PlayerStats; total: number; pageSize: number }

      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data: json }))
      } catch { /* ignore */ }

      if (cancelled) return
      setHistory(json.history)
      setStats(json.stats)
      setTotal(json.total)
      setHasMore(json.history.length >= json.pageSize && json.total > json.history.length)
      setLoadState('ready')
    }

    // Uten .catch ble en kastende fetch (offline, DNS, avbrutt forbindelse) en
    // uhåndtert rejection, og loadState sto på 'loading' — spinner uten utvei.
    // Samme mønster som load() i app/liga/page.tsx.
    load().catch(() => { if (!cancelled) setLoadState('error') })
    return () => { cancelled = true }
  }, [router])

  // Append the next page to history without touching stats or the graph.
  const loadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const nextPage = page + 1
      const res = await fetch(`/api/historikk?page=${nextPage}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return
      const json = await res.json() as { history: HistoryAttempt[]; total: number; pageSize: number }
      setHistory(prev => [...prev, ...json.history])
      setPage(nextPage)
      setTotal(json.total)
      setHasMore(json.total > history.length + json.history.length)
    } catch { /* ignore */ } finally {
      setLoadingMore(false)
    }
  }

  if (loadState === 'loading') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', padding: '40px 20px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SkeletonCard rows={3} showHeader={false} style={{ height: 120 }} />
            <SkeletonCard rows={8} showHeader />
          </div>
        </div>
      </>
    )
  }

  if (loadState === 'error') {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <div style={s.centered}>
          <div style={{ textAlign: 'center' as const }}>
            <p style={s.spinner}>Vi klarte ikke å hente historikken.</p>
            <p style={{ fontSize: 13, color: '#918f8a', marginTop: 12 }}>
              {/* Bevisst hard navigasjon, ikke <Link>: «Prøv igjen» peker på
                  siden brukeren allerede står på. Full sidelast er hele poenget. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/historikk" style={{ color: '#e8e4dd', textDecoration: 'underline' }}>Prøv igjen</a>
            </p>
          </div>
        </div>
      </>
    )
  }

  const progMsg = stats?.progresjon ?? null

  const hero = stats
    ? decideHero({
        totalAttempts: stats.total_attempts,
        deltakelsesrekke: stats.deltakelsesrekke,
        lengsteDeltakelsesrekke: stats.lengste_deltakelsesrekke,
      })
    : { kind: 'empty' as const }

  // «Beste resultat» finnes IKKE i PlayerStats og kan bare utledes av
  // `history` — som er paginert med 50 rader per side. Regnes den på en delvis
  // liste, blir raden «beste av de 50 siste» uten at noe ser galt ut, og den
  // ville bommet for nettopp de mest trofaste spillerne, som er de eneste som
  // noen gang passerer 50 quizer.
  //
  // Vakten er eksakt, ikke et anslag: `total` er radantallet i basen (count
  // exact fra API-et), `history.length` er det vi faktisk holder. Er de like,
  // har vi alt. Ellers sendes null, og decideRecords utelater raden — helt til
  // brukeren trykker «Last inn flere», og den dukker opp av seg selv.
  const historikkErKomplett = total > 0 && history.length >= total
  const besteResultat = historikkErKomplett ? pickBesteResultat(history) : null

  const recordRows = stats
    ? decideRecords({
        besteResultat,
        bestStreak: stats.best_streak,
        lengsteDeltakelsesrekke: stats.lengste_deltakelsesrekke,
        totalAttempts: stats.total_attempts,
        heroViserRekke: hero.kind === 'rekke',
      })
    : []

  if (historyLocked) {
    return (
      <>
        <style>{FONT_IMPORT}</style>
        <SiteNav />
        <div style={s.wrap}>
          <div style={s.page}>
            <div style={{ paddingTop: 48, maxWidth: 520, margin: '0 auto' }}>
              <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '24px 24px' }}>
                <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 20, fontWeight: 700, color: '#ffffff', marginBottom: 10 }}>
                  Historikken din er lagret
                </p>
                <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 20 }}>
                  Du har spilt mens du var innlogget, så resultatene og poengene dine
                  ligger lagret. Historikk, statistikk og nøyaktig plassering krever
                  Premium.
                </p>
                <a href="/premium" style={{ display: 'inline-block', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 28px', color: '#e8e4dd', fontSize: 14, fontWeight: 600, textDecoration: 'none', fontFamily: "'Instrument Sans', sans-serif" }}>
                  Se hva Premium gir →
                </a>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <ErrorBoundary>
    <>
      <style>{FONT_IMPORT}</style>
      <SiteNav />
      <div style={s.wrap}>
        <div style={s.page}>

          {/* Tilbake */}
          <div style={{ paddingTop: 20 }}>
            <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
          </div>

          {/* Hero — tilstandsstyrt, all beslutningslogikk i
              lib/historikk-oversikt.ts (decideHero).

              Her sto til 13. august 2026 «#N — din beste plassering» i 64px
              gull. Tallet ble regnet live over attempts i stedet for å leses
              fra season_scores, så det kunne oppstå også for spillere som ikke
              har noen global plassering i det hele tatt. Og det pekte bakover
              for de fleste: av 75 spillere med minst 3 quizer har bare 11 sin
              beste plassering fra siste quiz.

              Rangering hører hjemme på topplista, som er laget for det.
              Heroen svarer nå på «kommer jeg tilbake?» — det spørsmålet
              /historikk faktisk er til for. */}
          <div style={s.hero}>
            <div style={s.heroEyebrow}>Din historikk · Premium</div>
            {hero.kind !== 'empty' ? (
              <>
                <div style={s.heroNum}>{hero.tall}</div>
                <div style={s.heroNumLabel}>{hero.label}</div>
                <div style={s.heroSub}>{hero.sub}</div>
              </>
            ) : (
              <div style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#ffffff', lineHeight: 1, marginBottom: 10 }}>
                Din historikk
              </div>
            )}
            <div style={s.heroRule} />
            {/* Lenken het «Se ukens leaderboard», men `history` er sortert på
                completed_at DESC, så history[0] er brukerens SIST SPILTE quiz —
                ikke ukens. For en som ikke spilte denne uka pekte den på en
                gammel quiz (Dennis' egen side pekte på 3. juli). Teksten
                beskriver nå det lenken faktisk gjør, og er sann uansett når
                brukeren sist spilte. Skal den peke på ukens quiz, må klienten
                få vite hvilken quiz det ER — et nytt datapunkt, ikke en
                tekstendring. */}
            {history.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <Link
                  href={`/leaderboard/${history[0].quiz_id}`}
                  style={{ fontSize: 12, color: '#e8e4dd', textDecoration: 'none', letterSpacing: '0.02em' }}
                >
                  Se leaderboard for din siste quiz →
                </Link>
              </div>
            )}
          </div>

          {/* Kategoristyrken sier noe om hvor spilleren står NÅ, og står derfor
              over den bakoverskuende statistikken.

              DET EGNE DELTAKELSESREKKE-KORTET ER FJERNET (13. august 2026).
              Det viste rekken som tall og rekorden som kontekstlinje — begge
              deler bor nå ett sted hver: rekken i heroen, rekorden i heroens
              undertekst når heroen viser rekken, ellers i Rekorder-kortet
              under. Beholdt man kortet, ville rekorden stått to steder på
              samme skjerm i nøyaktig de tilstandene der heroen viser totalen.
              Kortets «0 nå»-tilstand er samtidig den typen bare nulltall denne
              omskrivingen finnes for å fjerne — at rekken er brutt sier
              heroens undertekst nå med ord.

              Samme betingelse som blokken lenger ned — `stats.total_attempts > 0`
              — står bevisst to steder framfor at ScoreGraph flyttes inn i den:
              grafen rendres uavhengig av `stats` og har sin egen tom-tilstand
              for under to quizer. */}
          {stats && stats.total_attempts > 0 && (
            <>

              {/* Kategoristyrke settes alltid samlet av getPlayerStats — begge
                  er null, eller ingen er det. Er de null, vises ingenting;
                  ingen tom-tilstand er ønsket her. */}
              {stats.sterkeste_kategori !== null && stats.svakeste_kategori !== null && (
                <div style={s.catRow}>
                  <div style={s.catCard}>
                    <div style={s.catVal}>{stats.sterkeste_kategori}</div>
                    <KategoriTall
                      prosent={stats.sterkeste_kategori_prosent}
                      riktige={stats.sterkeste_kategori_riktige}
                      besvart={stats.sterkeste_kategori_besvart}
                    />
                    <div style={s.featuredLbl}>Sterkeste kategori</div>
                    <div style={s.featuredCtx}>på tvers av all historikken din</div>
                  </div>
                  <div style={s.catCard}>
                    <div style={s.catVal}>{stats.svakeste_kategori}</div>
                    <KategoriTall
                      prosent={stats.svakeste_kategori_prosent}
                      riktige={stats.svakeste_kategori_riktige}
                      besvart={stats.svakeste_kategori_besvart}
                    />
                    <div style={s.featuredLbl}>Svakeste kategori</div>
                    <div style={s.featuredCtx}>her er det mest å hente</div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Utvikling — rendrer null under to quizer, se ScoreGraph. */}
          <ScoreGraph history={history} progMsg={progMsg} feltSnitt={stats?.felt_snitt_riktige ?? {}} />

          {/* Rekorder — erstatter det gamle 4-rutersnettet.

              HER LÅ «BEDRE ENN ANDRE» / «RASKERE ENN ANDRE». Begge er fjernet
              13. august 2026, uten erstatning. Ikke bygg dem tilbake:

              • Tempo-persentilen målte ingenting. Korrelasjonen mellom tempo
                og treffsikkerhet er 0,06 over de 77 spillerne med minst 3
                quizer i prod — altså null. Raskeste spiller ligger på 53 %
                snitt, tregeste på 36 %, og de beste ligger midt i tempofeltet.
                Tallet så ut som en ferdighet og var det ikke.
              • Score-persentilen sammenlignet brukerens ALL-TIME-snitt mot
                ENKELTFORSØK siste 90 dager — to ulike nivåer og to ulike
                tidsvinduer i samme sammenligning.
              • De to sto side om side med hver sin nevner, og «2 % bedre» over
                ordet «bedre» leses som en prestasjon når det i praksis betyr
                nest sist.

              Feltene `bedre_enn_prosent` og `raskere_enn_prosent` beregnes
              fortsatt i getPlayerStats og ligger i API-svaret; de har bare
              ingen leser lenger. De ryddes når API-et uansett skal endres.

              «Beste plassering» er BEVISST IKKE flyttet hit. Den skal komme
              fra season_scores.rank, ikke fra den live-beregnede rangeringen i
              computeRanks() som kan gi en plassering til spillere som ikke har
              noen global plassering i det hele tatt. Et fabrikkert tall skal
              ikke flyttes, det skal vente.

              SKJULES UNDER TO RADER, ikke under én: et kort med én rad ser ut
              som en feil, ikke som en tilstand — det bruker full kortramme,
              overskrift og luft på å si ett tall. Gjelder 4 av 137 spillere i
              prod (3 uten rader, 1 med én). */}
          {recordRows.length >= 2 && (
            <div style={s.recCard}>
              <div style={s.recHeader}>Rekorder</div>
              {recordRows.map((rad, i) => (
                <div key={rad.label}>
                  {i > 0 && <div style={s.recDivider} />}
                  <div style={i === 0 ? s.recRowFirst : s.recRow}>
                    <span style={s.recLbl}>{rad.label}</span>
                    <span style={s.recVal}>{rad.verdi}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quiz list */}
          {history.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyIcon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#918f8a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M5 6h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>
              </div>
              <div style={s.emptyTitle}>Ingen historikk ennå</div>
              <p style={s.emptySub}>Spill en quiz mens du er innlogget, så dukker den opp her.</p>
              <Link href="/" style={s.btnGold}>Finn en quiz</Link>
            </div>
          ) : (
            <>
              {/* Tellepillen er ENESTE visning av totalen her. Under lå tidligere
                  «{total} quizer totalt», som viste nøyaktig samme tall rett under
                  pillen — og ubøyd, så én spilt quiz ga «1 quizer totalt». Pillen
                  er beholdt framfor setningen fordi den er mønsteret alle de andre
                  seksjonsoverskriftene bruker (liga, historikk/[attemptId], to
                  steder i leaderboard/[id]), ingen av dem med en setning ved siden
                  av. Seksjonsetiketten til venstre bærer substantivet, så tallet
                  trenger det ikke. */}
              <div style={s.sectionHeader}>
                <span style={s.sectionText}>Siste quizer</span>
                <div style={s.sectionLine} />
                <span style={s.sectionCount}>{total > 0 ? total : history.length}</span>
              </div>

              {history.map((attempt) => {
                const pct = scorePct(attempt.correct_answers, attempt.total_questions)
                const isHovered = hoveredRowId === attempt.id
                return (
                  <Link
                    key={attempt.id}
                    href={`/historikk/${attempt.id}`}
                    style={isHovered ? s.rowHover : s.rowBase}
                    onMouseEnter={() => setHoveredRowId(attempt.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                  >
                    <div style={s.rowLeft}>
                      <div style={s.rowTitle}>{attempt.quiz_title}</div>
                      <div style={s.rowMeta}>
                        {formatDate(attempt.completed_at)}
                        {attempt.correct_streak !== null && attempt.correct_streak > 1 && (
                          <> · {attempt.correct_streak} på rad</>
                        )}
                      </div>
                    </div>
                    <div style={s.rowRight}>
                      {attempt.rank !== null && attempt.total_players !== null ? (
                        <div style={s.rowRank}>#{attempt.rank} av {attempt.total_players}</div>
                      ) : (
                        <div style={s.rowRank}>{attempt.correct_answers}/{attempt.total_questions}</div>
                      )}
                      <div style={s.rowScore}>
                        {attempt.correct_answers} av {attempt.total_questions} riktige
                      </div>
                      <div style={s.rowSub}>{pct}% · {formatTime(attempt.total_time_ms)}</div>
                    </div>
                  </Link>
                )
              })}

              {hasMore && (
                <button
                  style={{ ...s.btnMore, opacity: loadingMore ? 0.6 : 1 }}
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Laster...' : 'Last inn flere'}
                </button>
              )}
            </>
          )}

        </div>
      </div>
    </>
    </ErrorBoundary>
  )
}
