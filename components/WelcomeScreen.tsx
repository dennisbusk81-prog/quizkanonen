'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import WelcomeShell from '@/components/WelcomeShell'
import { supabase } from '@/lib/supabase'
import { fetchResult, type Loaded } from '@/lib/fetch-result'
import { toLoadedRow } from '@/lib/profile-load'
import { withTimeout, type TimedOutcome } from '@/lib/with-timeout'
import {
  WELCOME_BANNER_SEEN_KEY,
  classifyNameSave,
  decideNavigation,
  greetingName,
  isValidDisplayName,
  shouldAskForName,
  welcomeExitPath,
  type SaveOutcome,
} from '@/lib/welcome-onboarding'
import {
  WELCOME_FONT_IMPORT,
  welcomeBodyText,
  welcomeCard,
  welcomeErrorBox,
  welcomeHintText,
  welcomePrimaryButton,
} from '@/lib/welcome-styles'

// Velkomstskjermen for en helt fersk B2C-bruker. Én skjerm, ett valg, én knapp.
//
// HELE HENSIKTEN er linje e): fredagsvarselet. `profiles.email_reminders` er
// opt-in (NOT NULL DEFAULT false), bryteren ligger på profilsiden der ingen
// leter, og 133 av 145 profiler står derfor på false — altså har de fleste nye
// brukere i praksis ingen vei tilbake til neste fredagsquiz. Denne siden spør om
// samtykket i det ene øyeblikket brukeren garantert er engasjert.
//
// YTELSESKONTRAKTEN (siden ligger midt i registreringsstien):
//   - Ingen nye spørringer i selve registreringsflyten. «Er brukeren ny?» er et
//     biprodukt av ensureProfileForUser, og den åpne quizen leses fra
//     /api/quiz/active — en rute som allerede fantes.
//   - Ingenting her kan henge. Hvert eneste await går gjennom withTimeout, og
//     hvert eneste utfall har en definert fallback. Klarer vi ikke å slå opp
//     den åpne quizen, går brukeren til forsiden i stedet for å vente.
//   - Ingen henting BLOKKERER knappen. Feiler navneoppslaget, vises feltet ikke
//     (og NameRequiredModal fanger opp saken på neste side); feiler skrivingen,
//     slipper vi taket senest ved andre trykk.

// Navneoppslaget. Kort, fordi utfallet kun avgjør om ett felt vises — det er
// bedre å la feltet være enn å la brukeren se på en spinner.
const NAME_LOAD_MS = 2500
// Sesjonsoppslaget. Samme størrelsesorden som AuthListener sin lock-ventil.
const SESSION_MS = 2000
// Oppslaget av åpen quiz ved knappetrykk. Kallet startet ved montering, så
// dette er nesten alltid en allerede oppfylt promise.
const QUIZ_LOOKUP_MS = 1500
// Skrivingene. Rausere — her har brukeren trykket og forventer at noe skjer.
const SAVE_MS = 8000

type NameSaveResult = { outcome: SaveOutcome; message: string | null }

/** Profilrad → «har brukeren et gyldig navn?», som en BEKREFTET henting. */
function toNameLoaded(outcome: TimedOutcome<{ data: unknown; error: unknown }>): Loaded<string | null> {
  // Timeout og spørringsfeil kollapser bevisst til samme «vet ikke» — skjermen
  // gjør det samme i begge tilfeller (skjuler feltet), og et skille ville bare
  // fristet noen til å behandle det ene som «mangler navn».
  if (!outcome.ok) return { ok: false }
  const row = toLoadedRow<{ display_name: string | null }>(outcome.value)
  if (!row.ok) return { ok: false }
  return { ok: true, value: row.value?.display_name ?? null }
}

export default function WelcomeScreen() {
  const [ready, setReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [nameLoad, setNameLoad] = useState<Loaded<string | null>>({ ok: false })

  const [nameInput, setNameInput] = useState('')
  // Forhåndsvalgt PÅ. Det er hele grepet: alt er valgt, så det finnes ingenting
  // å hoppe over, og derfor heller ingen «hopp over»-lenke.
  const [reminders, setReminders] = useState(true)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Antall trykk på «Kom i gang». Andre trykk navigerer ALLTID — se
  // decideNavigation. Ref, ikke state: verdien styrer ingen render.
  const attemptRef = useRef(0)
  // Oppslaget av åpen quiz startes ved montering slik at det som regel er ferdig
  // før brukeren rekker å trykke.
  const activeQuizRef = useRef<Promise<Loaded<string | null>> | null>(null)

  useEffect(() => {
    activeQuizRef.current = fetchResult(
      () => fetch('/api/quiz/active'),
      json => (json as { id?: string | null } | null)?.id ?? null,
    )
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const sessionOutcome = await withTimeout(supabase.auth.getSession(), { ms: SESSION_MS })
      if (cancelled) return

      // Bekreftet utlogget: denne siden har ingenting å tilby. Timeout er noe
      // ANNET — da vet vi ikke, og da rendrer vi heller siden og prøver å hente
      // sesjonen på nytt når brukeren trykker.
      if (sessionOutcome.ok && !sessionOutcome.value.data.session) {
        window.location.replace('/')
        return
      }

      const session = sessionOutcome.ok ? sessionOutcome.value.data.session : null
      if (!session) { setReady(true); return }

      setUserId(session.user.id)

      const rowOutcome = await withTimeout(
        Promise.resolve(
          supabase.from('profiles').select('display_name').eq('id', session.user.id).maybeSingle(),
        ),
        { ms: NAME_LOAD_MS },
      )
      if (cancelled) return

      setNameLoad(toNameLoaded(rowOutcome))
      setReady(true)
    })()

    return () => { cancelled = true }
  }, [])

  const asksForName = shouldAskForName(nameLoad)
  const knownName = nameLoad.ok ? nameLoad.value : null
  const firstName = greetingName(knownName)

  const trimmedName = nameInput.trim()
  const nameOk = !asksForName || isValidDisplayName(trimmedName)
  const canSubmit = ready && nameOk && !saving

  // Feltet er utfylt og lovlig etter tegnsettet, men mangler etternavn. Egen
  // beskjed fordi /api/profile/upsert avviser nettopp dette med 400, og en
  // bruker som får «Kom i gang» grået ut uten forklaring ikke har noe å gå på.
  const showFullNameHint =
    asksForName && trimmedName.length >= 2 && !isValidDisplayName(trimmedName)

  const accessToken = useCallback(async (): Promise<string | null> => {
    const outcome = await withTimeout(supabase.auth.getSession(), { ms: SESSION_MS })
    return outcome.ok ? (outcome.value.data.session?.access_token ?? null) : null
  }, [])

  const savePreference = useCallback(async (token: string): Promise<void> => {
    // Resultatet leses bevisst ikke. Varselvalget får ALDRI påvirke om brukeren
    // kommer videre — og det er nettopp derfor det er et eget kall: et opptatt
    // navn (409 fra upsert) skal ikke ta med seg fredagsvarselet i fallet.
    await withTimeout(
      fetch('/api/profile/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email_reminders: reminders }),
      }),
      { ms: SAVE_MS },
    )
  }, [reminders])

  const saveName = useCallback(async (token: string, id: string): Promise<NameSaveResult> => {
    const outcome = await withTimeout(
      (async () => {
        const res = await fetch('/api/profile/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id, display_name: trimmedName }),
        })
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        return { status: res.status, message: json?.error ?? null }
      })(),
      { ms: SAVE_MS },
    )
    // Timeout eller kastet fetch → «failed», altså vår feil, ikke brukerens.
    if (!outcome.ok) return { outcome: 'failed', message: null }
    return { outcome: classifyNameSave(outcome.value.status), message: outcome.value.message }
  }, [trimmedName])

  const resolveExit = useCallback(async (): Promise<string> => {
    const pending = activeQuizRef.current
    if (!pending) return '/'
    const outcome = await withTimeout(pending, { ms: QUIZ_LOOKUP_MS })
    // Tok for lang tid, eller ruten svarte ikke → forsiden. Aldri venting.
    if (!outcome.ok || !outcome.value.ok) return '/'
    return welcomeExitPath(outcome.value.value)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSaving(true)
    setError(null)

    attemptRef.current += 1
    const attempt = attemptRef.current

    const token = await accessToken()

    const [nameResult] = await Promise.all([
      token && userId && asksForName ? saveName(token, userId) : Promise.resolve(null),
      token ? savePreference(token) : Promise.resolve(),
    ])

    const outcome: SaveOutcome | 'skipped' = nameResult ? nameResult.outcome : 'skipped'

    if (decideNavigation({ nameOutcome: outcome, attempt }) === 'stay') {
      // Rettbar avvisning, første trykk: vis serverens egen melding ORDRETT.
      // Den for «navnet er opptatt» (409) er skrevet for å bli lest av brukeren
      // og foreslår mellomnavn — samme tekst som NameRequiredModal og
      // profilsiden viser. Å erstatte den med noe eget ville gjort den verre.
      setError(nameResult?.message ?? 'Vi fikk ikke lagret navnet. Prøv igjen.')
      setSaving(false)
      return
    }

    // Vi går videre uansett hva som feilet. Mangler navnet fortsatt, fanger
    // NameRequiredModal det på neste side — den ligger i root layout.
    try {
      // Forsidens førstegangsbanner sier omtrent det samme som denne siden.
      // Stemples her slik at en fersk bruker ikke får beskjeden to ganger.
      localStorage.setItem(WELCOME_BANNER_SEEN_KEY, '1')
    } catch { /* privat modus e.l. — banneret er ikke verdt en feilskjerm */ }

    window.location.assign(await resolveExit())
  }, [accessToken, asksForName, canSubmit, resolveExit, saveName, savePreference, userId])

  if (!ready) {
    return (
      <>
        <style>{WELCOME_FONT_IMPORT}</style>
        <div style={{
          minHeight: '100vh', background: '#1a1c23',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <p style={{
            fontFamily: "'Libre Baskerville', serif", fontSize: 18,
            color: '#918f8a', fontStyle: 'italic',
          }}>
            Gjør klar …
          </p>
        </div>
      </>
    )
  }

  return (
    <WelcomeShell
      styleExtra=" * { box-sizing: border-box; }"
      eyebrow="Velkommen"
      title={firstName ? <>Hei, {firstName}</> : <>Velkommen inn</>}
      lead={<>Ny quiz hver fredag. 15 spørsmål, én toppliste.</>}
    >
      <div style={welcomeCard}>
        {/* Den ENE setningen om Premium. Ingen knapp, ingen pris, ingen paywall
            — siste ledd tar trykket av i stedet for å legge det på. */}
        <p style={{ ...welcomeBodyText, marginBottom: asksForName ? 24 : 20 }}>
          Det er gratis å spille. Med Premium får du full historikk, egne ligaer
          og mer — men det kan du se på senere.
        </p>

        {/* Navnefeltet vises KUN når vi vet at navnet mangler. Har brukeren
            allerede navn (typisk fra Google), finnes feltet ikke i det hele
            tatt — ingen forhåndsutfylt verdi å godkjenne. */}
        {asksForName && (
          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="qk-welcome-name"
              style={{
                display: 'block', fontSize: 11, fontWeight: 600,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                color: '#918f8a', marginBottom: 8,
              }}
            >
              Hva heter du?
            </label>
            <input
              id="qk-welcome-name"
              type="text"
              value={nameInput}
              onChange={e => { setNameInput(e.target.value); setError(null) }}
              placeholder="Fornavn Etternavn"
              maxLength={40}
              autoComplete="name"
              style={{
                width: '100%', background: '#1a1c23', border: '1px solid #2a2d38',
                borderRadius: 10, padding: '12px 14px', fontSize: 15, color: '#ffffff',
                fontFamily: "'Instrument Sans', sans-serif", outline: 'none',
              }}
            />
            <p style={{ ...welcomeHintText, fontSize: 12, marginTop: 8 }}>
              {showFullNameHint
                ? 'Bruk fornavn og etternavn — navnet vises på topplisten.'
                : 'Navnet vises på topplisten.'}
            </p>
          </div>
        )}

        {/* ETT valg. Tre brytere hadde vært et skjema. */}
        <div
          role="checkbox"
          aria-checked={reminders}
          tabIndex={0}
          onClick={() => setReminders(v => !v)}
          onKeyDown={e => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setReminders(v => !v) }
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px', cursor: 'pointer',
            background: reminders ? 'rgba(201,168,76,0.06)' : '#1a1c23',
            border: `1px solid ${reminders ? '#c9a84c' : '#2a2d38'}`,
            borderRadius: 10,
          }}
        >
          <span style={{
            width: 18, height: 18, borderRadius: 5, flexShrink: 0,
            border: `1px solid ${reminders ? '#c9a84c' : '#3a3d48'}`,
            background: reminders ? '#c9a84c' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* SVG, ikke emoji — designsystemet tillater ikke emoji i UI. */}
            {reminders && (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 6.2L4.8 8.5L9.5 3.8" stroke="#1a1c23" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#ffffff' }}>
            Få e-post når fredagsquizen åpner
          </span>
        </div>
      </div>

      {error && <div style={welcomeErrorBox}>{error}</div>}

      <button onClick={handleSubmit} disabled={!canSubmit} style={welcomePrimaryButton(!canSubmit)}>
        {saving ? 'Et øyeblikk …' : 'Kom i gang'}
      </button>

      <p style={{ ...welcomeHintText, textAlign: 'center', marginTop: 12 }}>
        Du kan endre dette når som helst på profilen din.
      </p>
    </WelcomeShell>
  )
}
