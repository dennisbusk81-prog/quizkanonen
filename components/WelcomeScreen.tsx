'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import WelcomeShell from '@/components/WelcomeShell'
import { supabase } from '@/lib/supabase'
import { useProfile } from '@/components/ProfileProvider'
import { fetchResult, type Loaded } from '@/lib/fetch-result'
import { withTimeout } from '@/lib/with-timeout'
import {
  WELCOME_BANNER_SEEN_KEY,
  classifyNameSave,
  decideNavigation,
  greetingName,
  isValidDisplayName,
  nameFieldState,
  quizStatusLine,
  welcomeExitPath,
  type SaveOutcome,
} from '@/lib/welcome-onboarding'
import {
  welcomeBodyText,
  welcomeCard,
  welcomeErrorBox,
  welcomeHintText,
  welcomePrimaryButton,
} from '@/lib/welcome-styles'

// Velkomstskjermen for en helt fersk B2C-bruker. Én skjerm, ett valg, én knapp.
//
// HELE HENSIKTEN er fredagsvarselet: `profiles.email_reminders` er opt-in
// (NOT NULL DEFAULT false), bryteren ligger på profilsiden der ingen leter, og
// 133 av 145 profiler sto derfor på false — de fleste nye brukere hadde i
// praksis ingen vei tilbake til neste fredagsquiz. Denne siden spør om
// samtykket i det ene øyeblikket brukeren garantert er engasjert.
//
// INGEN EGEN OPPSTARTSHENTING (omskrevet 7. august 2026). Første versjon
// gjorde getSession() + egen profiles-spørring ved montering — og ble dermed
// en TREDJE getSession()-konkurrent bak auth-låsen på nettopp den siden der
// sesjonen akkurat er skrevet (UserMenu og AuthListener kaller den også ved
// montering). Timet noen av leddene ut, kollapset «vet ikke» til «har navn»,
// feltet forsvant, og NameRequiredModal fanget navnet på NESTE side — den
// doble navnespørringen AuthListener-unntaket skulle fjerne. Skjedde i prod
// 6. august med support@-testkontoen.
//
// Nå leses alt fra useProfile(): ProfileProvider henter allerede nøyaktig
// denne kolonnen bak ÉN delt auth-subscription. Null kall ved montering
// utover /api/quiz/active (som også gir statuslinjen), og siden rendrer
// UMIDDELBART — ingen «Gjør klar …»-vent.
//
// getSession() brukes fortsatt VED KNAPPETRYKK for access token — der virket
// den beviselig også da oppstarten feilet (email_reminders ble lagret).

// Sesjonsoppslaget ved knappetrykk.
const SESSION_MS = 2000
// Oppslaget av åpen quiz ved knappetrykk. Kallet startet ved montering, så
// dette er nesten alltid en allerede oppfylt promise.
const QUIZ_LOOKUP_MS = 1500
// Skrivingene. Rausere — her har brukeren trykket og forventer at noe skjer.
const SAVE_MS = 8000

type NameSaveResult = { outcome: SaveOutcome; message: string | null }

export default function WelcomeScreen() {
  // displayNameRaw er den RÅ kolonneverdien. `displayName` fra samme context
  // har fallback til e-postens lokaldel og skal ALDRI brukes her — se
  // nameFieldState i lib/welcome-onboarding.ts og mutasjonsbeviset i testene.
  const { userId, displayNameRaw, displayName, resolved } = useProfile()

  const [nameInput, setNameInput] = useState('')
  // Forhåndsvalgt PÅ. Det er hele grepet: alt er valgt, så det finnes ingenting
  // å hoppe over, og derfor heller ingen «hopp over»-lenke.
  const [reminders, setReminders] = useState(true)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Svaret fra /api/quiz/active — driver BÅDE statuslinjen og «Kom i gang»-
  // målet. null = ikke landet ennå; statuslinjen viser da den nøytrale
  // varianten og oppgraderes når svaret kommer. Aldri noen venting.
  const [activeQuiz, setActiveQuiz] = useState<Loaded<string | null> | null>(null)
  const activeQuizRef = useRef<Promise<Loaded<string | null>> | null>(null)

  // Antall trykk på «Kom i gang». Andre trykk navigerer ALLTID — se
  // decideNavigation. Ref, ikke state: verdien styrer ingen render.
  const attemptRef = useRef(0)

  useEffect(() => {
    const pending = fetchResult(
      () => fetch('/api/quiz/active'),
      json => (json as { id?: string | null } | null)?.id ?? null,
    )
    activeQuizRef.current = pending
    let cancelled = false
    pending.then(result => { if (!cancelled) setActiveQuiz(result) })
    return () => { cancelled = true }
  }, [])

  // Bekreftet utlogget → forsiden. `resolved` settes av ProfileProvider ved
  // første auth-event; ingen egen getSession() her.
  useEffect(() => {
    if (resolved && !userId) window.location.replace('/')
  }, [resolved, userId])

  // 'show' | 'hide' | 'pending'. `displayName` sendes med KUN som dokumentert
  // felle — funksjonen leser den ikke, og testene feller en versjon som gjør.
  const fieldState = nameFieldState({ displayNameRaw, displayName })
  const firstName = greetingName(displayNameRaw.ok ? displayNameRaw.value : null)

  const trimmedName = nameInput.trim()
  // Kun et SYNLIG felt kan kreve utfylling. 'pending' blokkerer aldri knappen:
  // vet vi ikke om navnet mangler, får brukeren gå — NameRequiredModal er
  // backstop, og å sperre en ny bruker på vår egen uvisshet er verst av alt.
  const nameOk = fieldState !== 'show' || isValidDisplayName(trimmedName)
  const canSubmit = nameOk && !saving

  // Feltet er utfylt og lovlig etter tegnsettet, men mangler etternavn. Egen
  // beskjed fordi /api/profile/upsert avviser nettopp dette med 400, og en
  // bruker som får «Kom i gang» grået ut uten forklaring ikke har noe å gå på.
  const showFullNameHint =
    fieldState === 'show' && trimmedName.length >= 2 && !isValidDisplayName(trimmedName)

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
      token && userId && fieldState === 'show' ? saveName(token, userId) : Promise.resolve(null),
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
  }, [accessToken, canSubmit, fieldState, resolveExit, saveName, savePreference, userId])

  return (
    <WelcomeShell
      styleExtra=" * { box-sizing: border-box; }"
      eyebrow="Quizkanonen"
      // Henvender seg til PERSONEN, ikke bare til situasjonen. Med navn hilser
      // vi — samme mønster som B2B-siden («Velkommen, Elkjøp Nordic»), men med
      // fornavn, som er varmere enn fullt navn.
      title={firstName ? <>Velkommen til Quizkanonen, {firstName}</> : <>Velkommen til Quizkanonen</>}
      // Forankringen: noe ekte og unikt som ingen konkurrent kan kopiere.
      // 2020 er året — /om forteller den samme historien («Da pandemien stengte
      // alt ned i 2020, startet jeg en fredagsquiz»). Hele poenget med linjen er
      // troverdighet, så årstallet må stemme med resten av produktet.
      lead={<>Fredagsquizen har gått hver uke siden 2020. Nå spiller du med.</>}
    >
      <div style={welcomeCard}>
        {/* Statuslinjen — hva skjer NÅ. Det er den som gir knappen mening. */}
        <p style={{ ...welcomeBodyText, color: '#ffffff', fontWeight: 600, marginBottom: fieldState === 'hide' ? 20 : 24 }}>
          {quizStatusLine(activeQuiz)}
        </p>

        {/* Navnefeltet — KUN når vi VET at navnet mangler. Har brukeren navn
            (typisk fra Google), finnes feltet ikke — ingen forhåndsutfylt
            verdi å godkjenne. */}
        {fieldState === 'show' && (
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
                fontFamily: "var(--font-instrument-sans), sans-serif", outline: 'none',
              }}
            />
            <p style={{ ...welcomeHintText, fontSize: 12, marginTop: 8 }}>
              {showFullNameHint
                ? 'Bruk fornavn og etternavn — navnet vises på topplisten.'
                : 'Navnet vises på topplisten — andre spillere ser hvem de konkurrerer mot.'}
            </p>
          </div>
        )}

        {/* «Vet ikke» får sin egen visning og blir ALDRI til «har navn».
            Plassholderen står i feltets område til contexten har landet —
            ProfileProvider har en 3s sikkerhetsventil, så den blir ikke
            stående. Blokkerer ikke knappen. */}
        {fieldState === 'pending' && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10,
              padding: '12px 14px',
            }}>
              <p style={{ ...welcomeHintText, fontSize: 13, margin: 0 }}>
                Henter profilen din …
              </p>
            </div>
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
          {/* Sier bevisst IKKE «fredagsquizen»: det kan komme temaquizer på
              andre dager, og varselet er et generelt løfte som må være sant for
              alle quizer. Statuslinjen over kan nevne fredag, fordi den
              beskriver den faktiske neste quizen. */}
          <span style={{ fontSize: 14, fontWeight: 600, color: '#ffffff' }}>
            Få e-post når en ny quiz åpner — så du aldri misser en
          </span>
        </div>
      </div>

      {error && <div style={welcomeErrorBox}>{error}</div>}

      <button onClick={handleSubmit} disabled={!canSubmit} style={welcomePrimaryButton(!canSubmit)}>
        {saving ? 'Et øyeblikk …' : 'Kom i gang'}
      </button>

      {/* Premium er en FOTNOTE, ikke hovedinnhold: det første en ny bruker
          leser skal ikke handle om hva hen ikke har. Frøet er bevisst plantet,
          men det plantes nederst, dempet. */}
      <p style={{ ...welcomeHintText, textAlign: 'center', marginTop: 14 }}>
        Det er gratis å spille. Med Premium får du full historikk, egne ligaer
        og mer — men det kan du se på senere.
      </p>
      <p style={{ ...welcomeHintText, fontSize: 12, textAlign: 'center', marginTop: 10 }}>
        Du kan endre valgene når som helst på profilen din.
      </p>
    </WelcomeShell>
  )
}
