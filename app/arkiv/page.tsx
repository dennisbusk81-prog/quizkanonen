'use client'

// ── /arkiv — listen over tidligere quizer som kan spilles på nytt ────────────
//
// [ARK-1] steg 1C, 27. august 2026. UGATET MED VILJE (Dennis-beslutning
// 27. august): gratisbrukere SKAL se at arkivet finnes — ikke skjult, ikke
// smakebit. Konvertering er primærmålet med hele funksjonen, rangert over alt
// annet. Gratisbrukeren ser listen og en låst tilstand; Premium ser listen og
// kan spille. Gaten sitter på serverens skriveflater (POST /api/arkiv og
// start-attempt) — denne siden gater kun AFFORDANSEN, aldri synligheten.
//
// ── ?org= — husets form fra /leaderboard/[id] ───────────────────────────────
// Org-scope kommer fra query-parameteren, ikke fra kontekst. Verdien bæres
// videre gjennom hele kjeden: /arkiv?org=x → /quiz/<kopi>?org=x →
// GET /api/arkiv/<kopi>/plassering?org=x. Glemmes den, måles en
// Elkjøp-ansatt mot det GLOBALE feltet — nettopp det som gjør funksjonen
// verdiløs for den betalende B2B-kunden. Lest via window.location (ikke
// useSearchParams) for å slippe en Suspense-grense på en statisk side —
// samme grep som /admin/login.
//
// Er brukeren org-medlem, tilbys scope-valget her (Norge / bedriften) — det
// er valget som avgjør hvilket felt spøkelsesplasseringen på resultatskjermen
// måles mot, og flaten sier det eksplisitt.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/components/ProfileProvider'
import { MAX_ARCHIVE_TITLE_LENGTH } from '@/lib/archive-create-rules'
import ErrorBoundary from '@/components/ErrorBoundary'

type ArkivQuiz = {
  id: string
  title: string
  closesAt: string | null
  questionIds: string[]
}

const s = {
  wrap:    { minHeight: '100vh', background: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", color: '#e8e4dd' },
  page:    { maxWidth: 680, margin: '0 auto', padding: '32px 20px 80px' },

  eyebrow: { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#c9a84c', marginBottom: 8 },
  title:   { fontFamily: "var(--font-libre-baskerville), serif", fontSize: 'clamp(24px, 5vw, 32px)', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.01em', marginBottom: 10 },
  intro:   { fontSize: 14, color: '#918f8a', lineHeight: 1.6, maxWidth: 520, marginBottom: 24 },

  // Scope-valget — hvilket felt «slik ville du havnet den uken» måles mot.
  scopeRow:    { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, marginBottom: 20 },
  scopeLabel:  { fontSize: 12, color: '#918f8a' },
  scopeBtn:    { fontSize: 12, fontWeight: 600, color: '#918f8a', background: 'transparent', border: '1px solid #2a2d38', padding: '5px 14px', borderRadius: 20, cursor: 'pointer', fontFamily: "var(--font-instrument-sans), sans-serif" },
  scopeBtnAktiv: { fontSize: 12, fontWeight: 600, color: '#1a1c23', background: '#e8e4dd', border: '1px solid #e8e4dd', padding: '5px 14px', borderRadius: 20, cursor: 'pointer', fontFamily: "var(--font-instrument-sans), sans-serif" },

  // Låst tilstand (gratis/uinnlogget) — sidens ENESTE gull-element.
  ctaCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px', marginBottom: 20 },
  ctaText:  { fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 14 },
  ctaBtn:   { display: 'inline-block', background: '#c9a84c', color: '#1a1c23', fontSize: 14, fontWeight: 700, padding: '10px 28px', borderRadius: 10, textDecoration: 'none' },

  row:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 },
  rowLeft:  { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "var(--font-libre-baskerville), serif", fontSize: 16, fontWeight: 700, color: '#ffffff', lineHeight: 1.3, marginBottom: 3, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const },
  rowMeta:  { fontSize: 12, color: '#918f8a' },
  rowRight: { flexShrink: 0 },

  spillBtn: { background: 'transparent', color: '#e8e4dd', fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10, border: '0.5px solid #918f8a', cursor: 'pointer', fontFamily: "var(--font-instrument-sans), sans-serif", whiteSpace: 'nowrap' as const },
  laastPill: { fontSize: 11, fontWeight: 600, color: '#918f8a', background: '#1a1c23', border: '1px solid #2a2d38', padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' as const },

  feil:     { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px 24px', textAlign: 'center' as const, fontSize: 14, color: '#918f8a', lineHeight: 1.6 },
  startFeil: { fontSize: 13, color: '#e8e4dd', lineHeight: 1.6, margin: '4px 0 12px', textAlign: 'center' as const },
  tom:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '40px 24px', textAlign: 'center' as const, fontSize: 14, color: '#918f8a', lineHeight: 1.6 },
  spinner:  { fontFamily: "var(--font-libre-baskerville), serif", fontSize: 16, color: '#918f8a', fontStyle: 'italic' as const, textAlign: 'center' as const, padding: '40px 0' },
  retryLenke: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: '#e8e4dd', textDecoration: 'underline' },
} as const

function formatUke(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  // Eksplisitt Europe/Oslo — samme grunn som formatNorDate i /quizer: datoen
  // skal være den norske kvelden quizen stengte, uansett leserens tidssone.
  return d.toLocaleDateString('nb-NO', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo',
  })
}

export default function ArkivPage() {
  const router = useRouter()
  const { userId, isPremium, loading: profileLoading, myOrgs } = useProfile()

  const [quizzes, setQuizzes] = useState<ArkivQuiz[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  // ?org= fra URL-en — kilden til sannhet er URL-en (husets form); knappene
  // under skriver den tilbake med replaceState. Lazy initializer, ikke en
  // effekt: verdien brukes først etter at profilen har landet (scope-valget
  // rendres bak profileLoading), så server-HTML-ens null rekker aldri å vises.
  const [orgSlug, setOrgSlug] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('org')?.trim() || null
  )
  const [startingId, setStartingId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  // Bumpes av retry-knappen — re-kjører henteeffekten. Effekten setter kun
  // ready/error; 'loading' eies av initial-tilstanden og av knappen selv.
  const [hentForsok, setHentForsok] = useState(0)
  useEffect(() => {
    let cancelled = false
    async function hentListe() {
      try {
        const res = await fetch('/api/arkiv')
        if (cancelled) return
        if (!res.ok) { setLoadState('error'); return }
        const json = await res.json() as { quizzes?: ArkivQuiz[] }
        if (cancelled) return
        setQuizzes(Array.isArray(json.quizzes) ? json.quizzes : [])
        setLoadState('ready')
      } catch {
        // Feil er ikke tomt (lib/fetch-result.ts-regelen): en mislykket
        // henting skal si «vet ikke», aldri vises som et tomt arkiv.
        if (!cancelled) setLoadState('error')
      }
    }
    void hentListe()
    return () => { cancelled = true }
  }, [hentForsok])

  const velgScope = (slug: string | null) => {
    setOrgSlug(slug)
    const url = new URL(window.location.href)
    if (slug) url.searchParams.set('org', slug)
    else url.searchParams.delete('org')
    window.history.replaceState(null, '', url.toString())
  }

  // Premium-spilleren trykker «Spill»: POST /api/arkiv lager kopien, og
  // kopien spilles som en vanlig quiz. ?org= bæres videre til spillsiden, som
  // sender den til plasseringsruten — se filhodet.
  const startArkivQuiz = async (quiz: ArkivQuiz) => {
    if (startingId) return
    setStartingId(quiz.id)
    setStartError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        router.push('/login?next=/arkiv')
        return
      }
      const res = await fetch('/api/arkiv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        // Tittelen er kildens egen: kopien SKAL hete det samme som quizen den
        // gjenskaper — det er tittelen som identifiserer «hvilken quiz» på
        // spill- og resultatskjermen. Kuttet ved serverens tak, ikke avvist:
        // en overlang kildetittel er ikke spillerens feil.
        body: JSON.stringify({
          title: quiz.title.slice(0, MAX_ARCHIVE_TITLE_LENGTH),
          question_ids: quiz.questionIds,
        }),
      })
      const json = await res.json().catch(() => null) as { quizId?: string; error?: string } | null
      if (res.status === 201 && json?.quizId) {
        router.push(`/quiz/${json.quizId}${orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : ''}`)
        return
      }
      // Serverens tekster er skrevet for spilleren (kvote-429, premium-403,
      // 503) — vis dem som de er, med generisk fallback.
      setStartError(json?.error ?? 'Noe gikk galt. Prøv igjen.')
      setStartingId(null)
    } catch {
      setStartError('Noe gikk galt. Prøv igjen.')
      setStartingId(null)
    }
  }

  // Låst tilstand: uinnlogget ELLER innlogget uten Premium. Mens profilen
  // laster vet vi ikke — da vises hverken lås eller Spill-knapp, så en
  // Premium-kunde aldri ser et blink av oppsalg (samme null-safe retning som
  // ProfileProvider selv).
  const laast = !profileLoading && (!userId || !isPremium)
  const kanSpille = !profileLoading && !!userId && isPremium

  return (
    <ErrorBoundary>
      <div style={s.wrap}>
        <div style={s.page}>
          <p style={s.eyebrow}>Quizkanonen</p>
          <h1 style={s.title}>Arkivet</h1>
          <p style={s.intro}>
            Spill tidligere quizer på nytt som trening. Resultatet teller ikke i
            sesongen — men på resultatskjermen ser du hvordan du ville havnet
            blant dem som spilte da quizen gikk.
          </p>

          {laast && (
            <div style={s.ctaCard}>
              <p style={s.ctaText}>
                Arkivet er en Premium-funksjon. Med Premium kan du spille alle
                tidligere quizer og se hvilken plass du ville fått den uken.
              </p>
              <a href="/premium" style={s.ctaBtn}>Få tilgang med Premium</a>
            </div>
          )}

          {/* Scope-valget vises kun for org-medlemmer som faktisk kan spille —
              det styrer hvilket felt plasseringen på resultatskjermen måles
              mot, og skal ikke stå som dødt valg på en låst liste. */}
          {kanSpille && myOrgs.length > 0 && (
            <div style={s.scopeRow}>
              <span style={s.scopeLabel}>Plasseringen måles mot:</span>
              <button
                style={orgSlug === null ? s.scopeBtnAktiv : s.scopeBtn}
                onClick={() => velgScope(null)}
              >
                Hele Norge
              </button>
              {myOrgs.map(o => (
                <button
                  key={o.orgSlug}
                  style={orgSlug === o.orgSlug ? s.scopeBtnAktiv : s.scopeBtn}
                  onClick={() => velgScope(o.orgSlug)}
                >
                  {o.orgName}
                </button>
              ))}
            </div>
          )}

          {startError && <p style={s.startFeil}>{startError}</p>}

          {loadState === 'loading' && <p style={s.spinner}>Henter arkivet …</p>}

          {loadState === 'error' && (
            <div style={s.feil}>
              Vi fikk ikke hentet arkivet akkurat nå.{' '}
              <button style={s.retryLenke} onClick={() => { setLoadState('loading'); setHentForsok(n => n + 1) }}>Prøv igjen</button>
            </div>
          )}

          {loadState === 'ready' && quizzes.length === 0 && (
            <div style={s.tom}>
              Arkivet er tomt ennå — quizene dukker opp her etter at de har stengt.
            </div>
          )}

          {loadState === 'ready' && quizzes.map(quiz => {
            const uke = formatUke(quiz.closesAt)
            return (
              <div key={quiz.id} style={s.row}>
                <div style={s.rowLeft}>
                  <div style={s.rowTitle}>{quiz.title}</div>
                  <div style={s.rowMeta}>
                    {uke ? `Gikk ${uke} · ` : ''}{quiz.questionIds.length} spørsmål
                  </div>
                </div>
                <div style={s.rowRight}>
                  {kanSpille ? (
                    <button
                      style={{ ...s.spillBtn, opacity: startingId && startingId !== quiz.id ? 0.5 : 1 }}
                      disabled={startingId !== null}
                      onClick={() => void startArkivQuiz(quiz)}
                    >
                      {startingId === quiz.id ? 'Starter …' : 'Spill'}
                    </button>
                  ) : laast ? (
                    <span style={s.laastPill}>Premium</span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ErrorBoundary>
  )
}
