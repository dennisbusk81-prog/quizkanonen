'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AuthForm, { type AuthView } from '@/components/AuthForm'

// Kun innpakningen: overlay, lukkeknapp og overskrift. Selve innloggingen bor i
// AuthForm, som deles med /login — modalen hadde tidligere en helt egen flyt
// (kun Google + magic link, ingen passordfelt i det hele tatt), så en bruker som
// hadde satt passord kunne ikke bruke det herfra. Ikke gjenta det: legg endringer
// i innloggingen i AuthForm, ikke her.

type Props = {
  open: boolean
  onClose: () => void
  next?: string
  description?: string
  /**
   * Overstyrer navigasjonen etter vellykket innlogging. Finnes for ÉTT
   * kallsted: quiz-sidens målstrek, der siden holder ferdigspilte svar i minnet
   * som ikke har rukket å bli lagret ennå (se [AU-2] i app/quiz/[id]/page.tsx).
   * En reload der ville kastet dem — og recoveryen som finnes via localStorage
   * krever at spilleren spiller siste spørsmål om igjen.
   *
   * Gjelder KUN passordinnlogging: Google og magic link forlater siden uansett,
   * og lander på `next`. Kallstedet må derfor tåle begge veier.
   */
  onSuccess?: () => void
}

// Reserven når kalleren ikke sender sin egen `description`. Den må være sann
// for en GRATIS innlogget bruker på ALLE kallstedene som arver den — i dag
// components/NavAuth.tsx (toppnavigasjonen, altså enhver SiteNav-side) og
// app/liga/bli-med/[token]/page.tsx (liga-invitasjon).
//
// Den gamle teksten («se din plassering og følge utviklingen din over tid»)
// lovet to ting som BEGGE er Premium-gatet: eksakt plassering, og
// historikk/statistikk. Se PAYWALL-LOGIKK i .claude/CLAUDE.md. Gratisbrukeren
// den ble vist til fikk et bånd og ingen historikk.
//
// Det den nye teksten lover er målt mot koden, ikke antatt: resultatene lagres
// på kontoen, og sesongpoeng er IKKE Premium-gatet — lib/award-season-points.ts
// har ingen premium-sjekk. Samme ordvalg som SIGNUP_DESCRIPTION under og
// quiz-sidens fire beskrivelser allerede bruker i prod.
const DEFAULT_DESCRIPTION = 'Logg inn, så lagres resultatene på deg og poengene teller i sesongen.'

// Overskriften følger skjermen AuthForm faktisk viser. Fram til nå sto den fast
// på «Logg inn»: et trykk på «Opprett konto» byttet to knapper og lot overskrift,
// undertekst og vilkårslinje stå — så skjermen så ut til å rykke i stedet for å
// skifte, og brukeren fikk ingen bekreftelse på at hun hadde gjort noe riktig.
//
// `gull` er ordet som settes i gull-kursiv, som «Logg <em>inn</em>». Det er
// TEKST, ikke en gullfylt flate — to-gule-regelen gjelder knapper og lenker, og
// overskriften har alltid vært satt slik.
const HEADINGS: Record<AuthView, { start: string; gull: string }> = {
  login: { start: 'Logg', gull: 'inn' },
  signup: { start: 'Opprett', gull: 'konto' },
  'sent-magic': { start: 'Sjekk', gull: 'innboksen' },
  'sent-reset': { start: 'Sjekk', gull: 'innboksen' },
  'sent-signup': { start: 'Sjekk', gull: 'innboksen' },
}

// Undertekst for registrering. Sier hva brukeren FÅR, ikke hva hun gjør, og
// holder seg til det en GRATIS konto faktisk gir: resultatet lagres, poengene
// teller i sesongen. Ikke lov noe som krever Premium (nøyaktig plassering,
// historikk, egen plass på sesong-topplisten) — samme ordvalg som quiz-sidens
// egne beskrivelser allerede bruker i prod.
const SIGNUP_DESCRIPTION = 'Kontoen er gratis. Resultatene lagres på deg, og poengene teller i sesongen.'

export default function AuthModal({ open, onClose, next, description, onSuccess }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<AuthView>('login')

  // Stabil referanse, så effekten i AuthForm kun fyrer når skjermen faktisk
  // skifter — ikke på hver render av modalen.
  const handleViewChange = useCallback((v: AuthView) => setView(v), [])

  // Nullstill i det modalen ÅPNES. AuthForm avmonteres når `open` er false
  // (`return null` under), så den melder «login» på nytt ved neste åpning — men
  // det skjer i en effekt, altså ETTER første render. Uten dette ville en modal
  // som ble lukket i registreringsmodus blinke «Opprett konto» i ett bilde
  // neste gang den åpnes.
  //
  // Justering under render, ikke i en effekt: React kjører komponenten på nytt
  // umiddelbart og rekker aldri å tegne den gamle verdien. En effekt ville både
  // tegnet det gale bildet først og gitt en kaskade-render (react-hooks-regelen
  // «Avoid calling setState() directly within an effect»). Dette er mønsteret
  // React selv anbefaler for «juster tilstand når en prop endrer seg».
  const [forrigeOpen, setForrigeOpen] = useState(open)
  if (open !== forrigeOpen) {
    setForrigeOpen(open)
    if (open) setView('login')
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  // Etter innlogging: gå til next hvis kallstedet ba om et bestemt mål (founders,
  // liga-invitasjon), ellers bli værende og laste siden på nytt — modalen åpnes
  // som regel midt i noe brukeren holder på med.
  //
  // `onSuccess` overstyrer begge: et kallsted som holder ulagret tilstand kan da
  // fortsette der brukeren var, i stedet for å miste den i en navigasjon.
  const handleSuccess = () => {
    if (onSuccess) { onSuccess(); return }
    if (next) window.location.assign(next)
    else window.location.reload()
  }

  const heading = HEADINGS[view]

  // PRESEDENS: en `description` fra kalleren vinner ALLTID over defaulten.
  // Quiz-siden setter sin ut fra quizens tilstand («Svarene dine ligger klare
  // — de teller på topplisten og i sesongen»), og den beskjeden er mer verdt
  // enn en generisk standardtekst. Defaulten er kun en reserve, og det er
  // RESERVEN som er modus-avhengig — ikke kallerens tekst.
  //
  // Kvitteringsskjermene har ingen undertekst i det hele tatt: AuthForm viser
  // da sin egen grønne «Sjekk innboksen din!»-boks, og en linje over den om
  // hvorfor man burde logge inn ville stått og pekt på noe brukeren nettopp
  // har gjort.
  const erKvittering = view.startsWith('sent-')
  const underTekst = erKvittering
    ? null
    : description ?? (view === 'signup' ? SIGNUP_DESCRIPTION : DEFAULT_DESCRIPTION)

  // PORTAL TIL document.body — vakten bor hos skriveren, ikke hos kalleren.
  // Et element med `filter`/`backdrop-filter`/`transform` på en FORFAR blir
  // containing block for `position: fixed`-etterkommere. Da NavAuth begynte å
  // rendre denne modalen inne i SiteNavs <nav> (backdropFilter: blur(12px),
  // c47b87f), målte overlegget 1280×54 — nav-baren, ikke viewporten — og
  // modalen viste bare lukkekrysset. Portalen gjør modalen trygg uansett hvor
  // den kalles fra. SSR-trygt: `open` starter false hos alle kallere, så
  // denne grenen nås først etter et klientklikk, når document finnes.
  // lib/authmodal-portal.test.ts feller at portalen fjernes.
  return createPortal(
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,11,15,0.72)',
        backdropFilter: 'blur(4px)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        overflowY: 'auto',
      }}
      role="dialog"
      aria-modal="true"
      /* Dialogens tilgjengelige navn må følge overskriften. Sto fast på «Logg
         inn», så en skjermleser meldte feil dialog i registreringsmodus. */
      aria-label={`${heading.start} ${heading.gull}`}
    >
      <div style={{
        width: '100%',
        maxWidth: '360px',
        background: '#21242e',
        border: '1px solid #2a2d38',
        borderRadius: '20px',
        padding: '36px 28px 32px',
        position: 'relative',
        margin: 'auto',
      }}>
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Lukk"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            color: '#918f8a',
            fontSize: 20,
            cursor: 'pointer',
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>

        {/* Header */}
        <p style={{
          fontFamily: "var(--font-instrument-sans), sans-serif",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#c9a84c',
          textAlign: 'center',
          marginBottom: 8,
        }}>
          Quizkanonen
        </p>
        <h2 style={{
          fontFamily: "var(--font-libre-baskerville), serif",
          fontSize: 24,
          fontWeight: 700,
          color: '#ffffff',
          textAlign: 'center',
          letterSpacing: '-0.01em',
          // Underteksten bærer normalt luften ned mot skillelinjen (28 px). På
          // kvitteringsskjermene finnes den ikke, og overskriften må overta
          // avstanden — ellers klemmes skillelinjen opp mot titelen.
          marginBottom: underTekst ? 6 : 28,
        }}>
          {heading.start} <em style={{ fontStyle: 'italic', color: '#c9a84c' }}>{heading.gull}</em>
        </h2>
        {underTekst && (
          <p style={{
            fontFamily: "var(--font-instrument-sans), sans-serif",
            fontSize: 13,
            color: '#e8e4dd',
            textAlign: 'center',
            marginBottom: 28,
            lineHeight: 1.5,
          }}>
            {underTekst}
          </p>
        )}

        <div style={{ height: 1, background: '#2a2d38', marginBottom: 24 }} />

        <AuthForm next={next} onSuccess={handleSuccess} variant="modal" onViewChange={handleViewChange} />
      </div>
    </div>,
    document.body
  )
}
