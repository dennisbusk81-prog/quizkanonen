'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { MIXED_QUIZ_CATEGORY, generatorCategoryOptions, type GenerationPlan } from '@/lib/generated-quiz-rules'
import {
  KANONKULER_BODY_TEXT,
  KANONKULER_EYEBROW,
  KANONKULER_FREE_CONFIRM_TEXT,
  KANONKULER_FREE_UPSELL_LINE,
  KANONKULER_TITLE,
  kanonkulerStatus,
} from '@/lib/kanonkuler-tekst'

// ── Kanonkule-kortet på forsiden (8. september 2026, kveld) ─────────────────
//
// Første synlige flate for generatoren (POST /api/tilfeldig-quiz, a025d46).
// Kortet REGNER ingenting: plan, kuler igjen og «1. oktober» kommer ferdig
// fra serveren (app/page.tsx — samme Promise.all som resten av den
// personaliserte grenen), og tekstene avgjøres i lib/kanonkuler-tekst.ts.
// Her bor bare flyten.
//
// ── FLYTEN ER ULIK FOR GRATIS OG PREMIUM, MED VILJE ─────────────────────────
//   gratis    ett bekreftelsessteg («Dette bruker én av to kanonkuler.») —
//             halve månedskvoten på et feiltrykk er en ekte skade når du
//             har to. Kun blandet quiz, og velgeren FINNES IKKE for henne:
//             ikke låst, ikke med hengelås — den rendres ikke.
//   premium   kategori først (Blandet er standard), så rett gjennom uten
//             bekreftelse — med tretti er friksjonen bare i veien.
// Når quizen er laget sendes hun rett inn i den (router.push til
// /quiz/[id]), som ved klikk på en hvilken som helst quiz. Ingen mellomskjerm.
//
// ── `remaining` null = «vet ikke» ───────────────────────────────────────────
// Tellingen mot ledgeren kan feile uavhengig av profilen. Da vises kortet
// uten statuslinje — handlingen står, og ruten avgjør (429 med ærlig tekst
// hvis kvoten faktisk er brukt). Vi påstår ikke et tall vi ikke har. Er
// PLANEN ukjent, rendres kortet ikke i det hele tatt (app/page.tsx): begge
// tekstsettene påstår noe om kontoen, og «nedgraderer aldri på transient
// feil» gjelder her som ellers.
//
// ── GULL ────────────────────────────────────────────────────────────────────
// Forsiden bruker allerede gull til quizkortets CTA (Spill quizen / Åpne
// quizen), Premium-merket og poengene. Kortet har derfor INGEN gullelement —
// knappen er hvit outline (samme form som Founders-knappen), lenkene til
// /premium (tom-teksten, og oppsalgslinja for gratis med kuler igjen) er
// vanlig lenkefarge.

type Props = {
  plan: GenerationPlan
  /** Kuler igjen denne måneden — null når tellingen feilet («vet ikke»). */
  remaining: number | null
  /** «1. oktober» — første dag i neste norske kalendermåned. */
  nextMonthLabel: string
}

type Phase = 'idle' | 'confirm' | 'starting'

const BLANDET = ''

const s = {
  card: {
    background: '#21242e',
    border: '1px solid #2a2d38',
    borderRadius: 16,
    padding: '28px 24px',
    marginTop: 16,
    marginBottom: 4,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: '#918f8a',
    marginBottom: 8,
  },
  title: {
    fontFamily: 'var(--font-libre-baskerville), serif',
    fontSize: 20,
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1.3,
    margin: '0 0 8px',
  },
  body: {
    fontSize: 14,
    color: '#e8e4dd',
    lineHeight: 1.6,
    margin: '0 0 14px',
  },
  status: {
    fontSize: 14,
    fontWeight: 600,
    color: '#ffffff',
    lineHeight: 1.6,
    margin: '0 0 16px',
  },
  statusTom: {
    fontSize: 14,
    color: '#e8e4dd',
    lineHeight: 1.6,
    margin: 0,
  },
  upsellLink: {
    color: '#e8e4dd',
    textDecoration: 'underline',
  },
  upsellLine: {
    fontSize: 13,
    lineHeight: 1.6,
    margin: '-8px 0 16px',
  },
  upsellLineLink: {
    color: '#e8e4dd',
    textDecoration: 'none',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: 13,
    color: '#918f8a',
  },
  select: {
    background: '#1a1c23',
    border: '1px solid #2a2d38',
    color: '#e8e4dd',
    borderRadius: 10,
    padding: '10px 14px',
    fontFamily: 'var(--font-instrument-sans), sans-serif',
    fontSize: 14,
    cursor: 'pointer',
  },
  btn: {
    background: 'transparent',
    border: '1px solid #e8e4dd',
    color: '#e8e4dd',
    fontFamily: 'var(--font-instrument-sans), sans-serif',
    fontSize: 15,
    fontWeight: 600,
    padding: '10px 28px',
    borderRadius: 10,
    width: 'auto',
    cursor: 'pointer',
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: 'default',
  },
  textBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    fontSize: 14,
    color: '#e8e4dd',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  confirmText: {
    fontSize: 14,
    color: '#e8e4dd',
    lineHeight: 1.6,
    margin: '0 0 12px',
  },
  error: {
    fontSize: 13,
    color: '#e8e4dd',
    lineHeight: 1.6,
    margin: '12px 0 0',
  },
} as const

export default function KanonkulerCard({ plan, remaining, nextMonthLabel }: Props) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [category, setCategory] = useState<string>(BLANDET)
  const [error, setError] = useState<string | null>(null)

  const status = remaining === null ? null : kanonkulerStatus({ plan, remaining, nextMonthLabel })

  const lagQuiz = async () => {
    if (phase === 'starting') return
    setPhase('starting')
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        router.push('/login?next=/')
        return
      }
      const res = await fetch('/api/tilfeldig-quiz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        // Gratis sender aldri kategori — velgeren finnes ikke for henne, og
        // ruten ville uansett svart 403. Premium: '' er Blandet = ingen kategori.
        body: JSON.stringify(plan === 'premium' && category !== BLANDET ? { category } : {}),
      })
      const json = await res.json().catch(() => null) as { quizId?: string; error?: string } | null
      if (res.status === 201 && json?.quizId) {
        router.push(`/quiz/${json.quizId}`)
        return
      }
      // Rutens tekster er skrevet for spilleren (kvote-429, 503) — vis dem
      // som de er, med generisk fallback.
      setError(json?.error ?? 'Noe gikk galt. Prøv igjen.')
      setPhase('idle')
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
      setPhase('idle')
    }
  }

  const onPrimary = () => {
    if (plan === 'free') {
      setPhase('confirm')
      return
    }
    void lagQuiz()
  }

  return (
    <section style={s.card} aria-labelledby="kanonkuler-tittel">
      <p style={s.eyebrow}>{KANONKULER_EYEBROW}</p>
      <h2 id="kanonkuler-tittel" style={s.title}>{KANONKULER_TITLE}</h2>
      <p style={s.body}>{KANONKULER_BODY_TEXT}</p>

      {status && status.kind === 'tom' ? (
        <p style={s.statusTom}>
          {status.text}
          {status.upsell && (
            <>
              {' · '}
              <Link href="/premium" style={s.upsellLink}>{status.upsell}</Link>
            </>
          )}
        </p>
      ) : (
        <>
          {status && <p style={s.status}>{status.text}</p>}
          {plan === 'free' && status?.kind === 'igjen' && (
            <p style={s.upsellLine}>
              <Link href="/premium" style={s.upsellLineLink}>{KANONKULER_FREE_UPSELL_LINE}</Link>
            </p>
          )}

          {phase === 'confirm' ? (
            <>
              <p style={s.confirmText}>{KANONKULER_FREE_CONFIRM_TEXT}</p>
              <div style={s.actions}>
                <button type="button" style={s.btn} onClick={() => void lagQuiz()}>
                  Lag quizen
                </button>
                <button type="button" style={s.textBtn} onClick={() => setPhase('idle')}>
                  Avbryt
                </button>
              </div>
            </>
          ) : (
            <div style={s.actions}>
              {plan === 'premium' && (
                <label style={s.label}>
                  Velg kategori{' '}
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    disabled={phase === 'starting'}
                    style={s.select}
                  >
                    <option value={BLANDET}>{MIXED_QUIZ_CATEGORY}</option>
                    {generatorCategoryOptions().map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                style={phase === 'starting' ? { ...s.btn, ...s.btnDisabled } : s.btn}
                disabled={phase === 'starting'}
                onClick={onPrimary}
              >
                {phase === 'starting' ? 'Lager quiz …' : 'Lag quiz'}
              </button>
            </div>
          )}
        </>
      )}

      {error && <p style={s.error} role="alert">{error}</p>}
    </section>
  )
}
