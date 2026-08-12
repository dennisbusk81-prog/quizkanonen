'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase, supabaseData } from '@/lib/supabase'
import UserMenuWrapper from '@/components/UserMenuWrapper'
import WelcomeShell from '@/components/WelcomeShell'
import { isOrgLocked } from '@/lib/org-access'
import { getSessionIdentity } from '@/lib/session-identity'
import type { Session } from '@supabase/supabase-js'
// Stilene lå tidligere som lokale konstanter i denne filen. De er FLYTTET,
// uendret, til lib/welcome-styles.ts slik at /velkommen (B2C) arver nøyaktig
// samme utseende. Kun presentasjon er delt — tilstandsmodellen her er urørt.
import {
  WELCOME_FONT_IMPORT,
  welcomeBodyText,
  welcomeCard,
  welcomeErrorBox,
  welcomeHeading,
  welcomeHintText,
  welcomePrimaryButton,
  welcomeStepLabel,
} from '@/lib/welcome-styles'

// ── Oppsett-siden for en fersk bedriftsadmin ─────────────────────────────────
//
// Ligger mellom registreringen og bedriftspanelet. Trial-veien
// (/bedrift/registrer) og den betalte veien (/bedrift/success) sender begge hit.
//
// Siden er BEVISST ikke engangs-gatet på et flagg: den tåler refresh, direkte
// navigasjon og gjensyn. Derfor forhåndsvelger den heller ingen svar — men den
// viser hva som er lagret i dag («Nå: …»), slik at en admin som kommer tilbake
// senere ser hva hen endrer FØR hen endrer det. Uten den linjen kunne et
// gjensyn stille skru på global synlighet for alle ansatte.
//
// Ingen ny skrivesti: alt lagres med én PATCH mot /api/org/[slug]/settings,
// samme rute som bedriftspanelets egne innstillinger bruker.

type OrgData = {
  org: {
    id: string
    name: string
    plan: string
    subscription_status: string | null
    allow_global_league: boolean
    weekly_report_timing: string
    org_quiz_opens_at: string | null
    org_quiz_closes_at: string | null
  }
}

type GlobalWindow = { opens: string; closes: string }

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** "HH:MM" i norsk veggklokke fra et UTC-instant. Kolonnene org_quiz_*_at
 *  tolkes som Europe/Oslo (se lib/oslo-time.ts), så vinduet må vises i samme
 *  tidssone — ellers sammenligner admin epler og pærer. */
function osloHhMm(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('no-NO', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** En arbeidsdag-vennlig frist, tre timer etter at quizen åpner.
 *
 *  ÅPNINGSTID TILBYS BEVISST IKKE. my-quiz-times klemmer org-vinduet med
 *  `max(orgOpens, globalOpens)`, så en åpning satt før det globale
 *  åpningstidspunktet har ingen effekt overhodet — feltet ville lovet noe det
 *  ikke kan holde. Bedriften styrer fristen; åpningen er felles for alle. */
function suggestDeadline(win: GlobalWindow | null): string {
  if (!win) return '15:00'
  return fromMinutes(Math.min(toMinutes(win.opens) + 180, toMinutes(win.closes)))
}

/** Valgrad med radioknapp. Ligger på modulnivå, ikke inne i siden: en komponent
 *  definert under render blir en ny type ved hver oppdatering, og React
 *  remounter den da i stedet for å oppdatere den. */
function RadioRow({
  selected, onSelect, title, sub,
}: { selected: boolean; onSelect: () => void; title: string; sub?: string }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '14px 16px', cursor: 'pointer',
        background: selected ? 'rgba(201,168,76,0.06)' : '#1a1c23',
        border: `1px solid ${selected ? '#c9a84c' : '#2a2d38'}`,
        borderRadius: 10,
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        border: `1px solid ${selected ? '#c9a84c' : '#3a3d48'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#c9a84c' }} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#ffffff', marginBottom: sub ? 3 : 0 }}>
          {title}
        </span>
        {sub && <span style={{ display: 'block', fontSize: 13, color: '#918f8a', lineHeight: 1.5 }}>{sub}</span>}
      </span>
    </div>
  )
}

export default function OrgVelkommenPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()

  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [data, setData] = useState<OrgData | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [globalWindow, setGlobalWindow] = useState<GlobalWindow | null>(null)

  // Ingen forhåndsvalgte svar på de to obligatoriske spørsmålene.
  const [allowGlobal, setAllowGlobal] = useState<boolean | null>(null)
  const [timeChoice, setTimeChoice] = useState<'custom' | 'default' | null>(null)
  const [closesAt, setClosesAt] = useState('')
  // Ukesrapporten er valgfri — mandag morgen er samme fallback som cronen og
  // admin-data allerede bruker når kolonnen er NULL.
  const [reportTiming, setReportTiming] = useState('monday_morning')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // Dep-en er den STABILE identiteten, ikke session-objektet — se
  // lib/session-identity.ts, samme grep som /premium og org/[slug]/admin.
  // `session` settes av to skrivere (getSession().then over, og
  // onAuthStateChange sin INITIAL_SESSION) som leverer SAMME logiske sesjon som
  // to ULIKE objekter. Med objektet i dep-lista kan React ikke bail-e ut på
  // referanselikhet, og effekten kjørte to ganger for en innlogget admin: to
  // samtidige kall mot admin-data, som er en tung samlerute, pluss to
  // redirect-forsøk i 403-/låst-grenene under. Utlogget passerer begge `null`
  // — referanselik — så feilen bet kun innloggede.
  //
  // `session` leses fortsatt friskt inne i effekten; identiteten avgjør kun NÅR
  // den kjører. Effekten fyrer derfor fortsatt på ekte endring (innlogging,
  // bytte av bruker, utlogging), men ikke på et nytt objekt for samme bruker
  // (TOKEN_REFRESHED ved fane-fokus).
  //
  // Vakten under er uendret i semantikk: 'unchecked' er nøyaktig det
  // `session === undefined` betydde.
  const sessionIdentity = getSessionIdentity(session)
  useEffect(() => {
    if (sessionIdentity === 'unchecked') return
    if (!session) { router.push(`/login?next=/org/${slug}/velkommen`); return }

    let cancelled = false
    fetch(`/api/org/${slug}/admin-data`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async r => {
        if (cancelled) return
        // 403 fra admin-data betyr «ikke admin i denne bedriften» (eller ikke
        // medlem). Begge hører hjemme på bedriftssiden, ikke i et oppsett de
        // ikke har lov til å gjøre.
        if (r.status === 403) { router.replace(`/org/${slug}`); return }
        if (!r.ok) { setLoadState('error'); return }

        const d: OrgData = await r.json()
        if (cancelled) return

        // Låst org skal ikke onboardes — lås-skjermen i panelet eier den saken.
        if (isOrgLocked(d.org)) { router.replace(`/org/${slug}/admin`); return }

        setData(d)
        // Har bedriften allerede en egen frist, er valget besvart før. Da fylles
        // feltet med den faktiske verdien i stedet for forslaget, slik at et
        // gjensyn ikke presenterer noe annet enn det som gjelder.
        if (d.org.org_quiz_closes_at) setClosesAt(d.org.org_quiz_closes_at.slice(0, 5))
        if (d.org.weekly_report_timing) setReportTiming(d.org.weekly_report_timing)
        setLoadState('ready')
      })
      .catch(() => { if (!cancelled) setLoadState('error') })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdentity, slug, router])

  // Det globale quiz-vinduet, lest fra siste ukesquiz. Vises som ramme rundt
  // tidsvalget — org-tidene kan aldri utvide vinduet, kun snevre det inn.
  useEffect(() => {
    let cancelled = false
    supabaseData
      .from('quizzes')
      .select('opens_at, closes_at')
      .eq('quiz_type', 'weekly')
      .eq('is_test', false)
      .order('closes_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data: q }) => {
        if (cancelled || !q?.opens_at || !q?.closes_at) return
        const opens = osloHhMm(q.opens_at)
        const closes = osloHhMm(q.closes_at)
        if (opens && closes) setGlobalWindow({ opens, closes })
      })
    return () => { cancelled = true }
  }, [])

  const suggestion = suggestDeadline(globalWindow)

  const chooseCustomDeadline = () => {
    setTimeChoice('custom')
    if (!closesAt) setClosesAt(suggestion)
  }

  // En frist FØR quizen åpner gir et tomt vindu: my-quiz-times setter åpningen
  // til den globale (12:00) og stengingen til fristen, så «11:00» ville stengt
  // quizen før den fantes. Derfor en reell sperre, ikke bare en advarsel.
  const deadlineValid =
    TIME_RE.test(closesAt) &&
    (!globalWindow || toMinutes(closesAt) > toMinutes(globalWindow.opens))

  const timesValid = timeChoice === 'default' || (timeChoice === 'custom' && deadlineValid)

  const canSubmit = allowGlobal !== null && timeChoice !== null && timesValid && !saving

  // Advarsel, ikke sperre: en frist etter den globale stengingen er lovlig å
  // lagre, men klemmes ned ved lesing — den gir altså ingen ekstra tid.
  const afterGlobalClose =
    timeChoice === 'custom' && globalWindow && TIME_RE.test(closesAt)
      ? toMinutes(closesAt) >= toMinutes(globalWindow.closes)
      : false

  const isStandard = data?.org.plan === 'standard'

  const save = async () => {
    if (!session || !data || !canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        // Stempler onboarding_completed_at (kun første gang). Det er dette
        // signalet bedriftspanelet leser for å slutte å sende admin hit —
        // se lib/org-onboarding.ts.
        onboarding_completed: true,
        allow_global_league: allowGlobal,
        // Åpningen nullstilles bevisst i begge grener: siden lover at quizen
        // åpner likt for alle, og da skal ikke en åpningstid satt tidligere i
        // panelet bli stående og motsi det. «Nå: …»-linja viser hva som gjelder
        // før admin lagrer.
        org_quiz_opens_at: null,
        org_quiz_closes_at: timeChoice === 'custom' ? closesAt : null,
      }
      // Ukesrapporten sendes KUN til Standard-bedrifter (cronen filtrerer på
      // plan='standard'). Planen leses fra admin-data, som er server-side og
      // admin-gatet — ikke fra noe klienten kan finne på selv. Å spørre en
      // Starter-admin om tidspunkt for en rapport som aldri kommer, ville vært
      // samme feil som panelet gjør i dag.
      if (isStandard) body.weekly_report_timing = reportTiming

      const res = await fetch(`/api/org/${slug}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? 'Kunne ikke lagre. Prøv igjen.')
        return
      }
      router.push(`/org/${slug}/admin`)
    } catch {
      setError('Kunne ikke lagre. Prøv igjen.')
    } finally {
      setSaving(false)
    }
  }

  // ── Laster / feil ──────────────────────────────────────────────────────────

  if (session === undefined || loadState === 'loading') {
    return (
      <>
        <style>{WELCOME_FONT_IMPORT}</style>
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#918f8a', fontStyle: 'italic' }}>
            Henter bedriften din …
          </p>
        </div>
      </>
    )
  }

  if (loadState === 'error' || !data) {
    return (
      <>
        <style>{WELCOME_FONT_IMPORT}</style>
        <UserMenuWrapper />
        <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "'Instrument Sans', sans-serif" }}>
          <div style={{ textAlign: 'center', maxWidth: 380 }}>
            <p style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 22, color: '#ffffff', marginBottom: 10 }}>
              Kunne ikke hente bedriften din
            </p>
            <p style={{ fontSize: 14, color: '#918f8a', marginBottom: 24, lineHeight: 1.6 }}>
              Vi fikk ikke kontakt akkurat nå. Ingenting er endret.
            </p>
            <a
              href={`/org/${slug}/velkommen`}
              style={{
                display: 'inline-block', padding: '10px 28px', background: '#c9a84c',
                color: '#1a1c23', borderRadius: 10, fontSize: 14, fontWeight: 700,
                textDecoration: 'none', fontFamily: "'Instrument Sans', sans-serif",
              }}
            >
              Prøv igjen
            </a>
          </div>
        </div>
      </>
    )
  }

  // ── Delte stiler ───────────────────────────────────────────────────────────
  //
  // Verdiene er flyttet til lib/welcome-styles.ts og deles nå med /velkommen.
  // De lokale navnene beholdes som aliaser med vilje: da står JSX-en under
  // BOKSTAVELIG uendret, og en gjennomgang trenger ikke lete etter om noe
  // logikk fulgte med på flyttelasset. Vil org-siden en dag avvike visuelt, er
  // det disse fem linjene som endres.

  const card = welcomeCard
  const stepLabel = welcomeStepLabel
  const heading = welcomeHeading
  const bodyText = welcomeBodyText
  const hintText = welcomeHintText

  // Org-spesifikk — /velkommen har ingen tidsfelt, så denne blir stående her.
  const timeInput = {
    width: '100%', background: '#1a1c23', border: '1px solid #2a2d38',
    borderRadius: 10, padding: '11px 14px', fontSize: 15, color: '#ffffff',
    fontFamily: "'Instrument Sans', sans-serif", outline: 'none',
  } as const

  const currentTimesLabel = data.org.org_quiz_closes_at
    ? `stenger ${data.org.org_quiz_closes_at.slice(0, 5)}`
    : 'Quizkanonens vanlige tider'

  // ── Siden ──────────────────────────────────────────────────────────────────

  return (
    <WelcomeShell
      styleExtra=" * { box-sizing: border-box; }"
      nav={<UserMenuWrapper />}
      eyebrow="Kom i gang"
      title={<>Velkommen, {data.org.name}</>}
      /* «Alt kan endres senere» står i INGRESSEN, FØR valgene — ikke bare som
         småtekst ved knappen. Det er den setningen som gjør begge valgene
         ufarlige å ta, og da må den leses før man tar dem. */
      lead={
        <>
          To korte valg, så er bedriften satt opp. Det tar et minutt — og alt
          kan endres senere under Innstillinger i bedriftspanelet.
        </>
      }
    >
          {/* 1 — Forklaring, ingen valg */}
          <div style={card}>
            <p style={stepLabel}>Slik fungerer det</p>
            <p style={{ ...bodyText, marginBottom: 10 }}>
              Ny quiz hver fredag — den samme quizen for alle som spiller Quizkanonen.
            </p>
            <p style={{ ...bodyText, marginBottom: 10 }}>
              Du inviterer de ansatte med én lenke fra bedriftspanelet. De spiller
              når det passer dem innenfor tidsvinduet.
            </p>
            <p style={bodyText}>
              Resultatet teller på {data.org.name} sin interne toppliste, der de
              konkurrerer mot hverandre gjennom hele sesongen.
            </p>
          </div>

          {/* 2 — Global toppliste (må besvares) */}
          <div style={card}>
            <p style={stepLabel}>Valg 1 av 2</p>
            <p style={heading}>Skal de ansatte vises på den åpne topplisten?</p>
            <p style={{ ...bodyText, marginBottom: 8 }}>
              Da får de ansatte konkurrere mot alle som spiller Quizkanonen, ikke
              bare mot hverandre. Samme quiz, større felt.
            </p>
            <p style={{ ...bodyText, marginBottom: 8 }}>
              Resultatene og visningsnavnene deres står da på den åpne topplisten,
              sammen med alle andre spillere.
            </p>
            <p style={{ ...hintText, marginBottom: 8 }}>
              Hver enkelt ansatt velger fortsatt selv — de får spørsmålet, og kan
              når som helst melde seg av på profilen sin.
            </p>
            <p style={{ ...hintText, marginBottom: 16 }}>
              Valget gjelder sesong-topplisten. De ansatte kan fortsatt vises på
              resultatlisten for den enkelte quizen.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              <RadioRow
                selected={allowGlobal === true}
                onSelect={() => setAllowGlobal(true)}
                title="Ja — vis de ansatte der"
                sub="Hver ansatt velger selv, og kan melde seg av."
              />
              <RadioRow
                selected={allowGlobal === false}
                onSelect={() => setAllowGlobal(false)}
                title="Nei — hold resultatene internt"
                sub="Ingen i bedriften vises utenfor bedriftens egen toppliste."
              />
            </div>

            <p style={hintText}>
              Nå: {data.org.allow_global_league ? 'ansatte kan vises på den åpne topplisten' : 'kun bedriftens egen toppliste'}
            </p>
          </div>

          {/* 3 — Quiz-tidspunkt (må besvares) */}
          <div style={card}>
            <p style={stepLabel}>Valg 2 av 2</p>
            <p style={heading}>Når skal quizen stenge hos dere?</p>
            <p style={{ ...bodyText, marginBottom: 8 }}>
              Quizen åpner {globalWindow ? globalWindow.opens : 'midt på dagen'} for
              alle som spiller Quizkanonen — den delen er felles. Men dere bestemmer
              selv når den skal stenge for de ansatte.
            </p>
            <p style={{ ...bodyText, marginBottom: 16 }}>
              {globalWindow
                ? `Uten en egen frist står den åpen til ${globalWindow.closes}, så de ansatte kan spille når som helst utover kvelden.`
                : 'Uten en egen frist står den åpen til sent på kvelden, så de ansatte kan spille når som helst utover kvelden.'}
              {' '}Vil dere heller at quizen tas i arbeidstiden, setter dere en tidligere frist.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              <RadioRow
                selected={timeChoice === 'custom'}
                onSelect={chooseCustomDeadline}
                title="Egen frist for bedriften"
                sub={`Forslag: stenger ${suggestion}. Juster som dere vil.`}
              />
              <RadioRow
                selected={timeChoice === 'default'}
                onSelect={() => setTimeChoice('default')}
                title="Bruk Quizkanonens vanlige frist"
                sub={globalWindow ? `Stenger ${globalWindow.closes}.` : 'Samme frist som alle andre.'}
              />
            </div>

            {timeChoice === 'custom' && (
              <div style={{ marginBottom: 12, maxWidth: 200 }}>
                <label style={{ ...stepLabel, display: 'block', marginBottom: 8 }}>Stenger</label>
                <input
                  type="time"
                  value={closesAt}
                  onChange={e => setClosesAt(e.target.value)}
                  style={timeInput}
                />

                {!deadlineValid && closesAt && globalWindow && (
                  <p style={{ fontSize: 13, color: '#f87171', marginTop: 12, lineHeight: 1.5 }}>
                    Fristen må være etter {globalWindow.opens}, ellers rekker ingen å spille.
                  </p>
                )}
                {deadlineValid && afterGlobalClose && globalWindow && (
                  <p style={{ ...hintText, marginTop: 12 }}>
                    Quizen stenger uansett {globalWindow.closes}, så en senere frist
                    gir ingen ekstra tid.
                  </p>
                )}
              </div>
            )}

            <p style={hintText}>Nå: {currentTimesLabel}</p>
          </div>

          {/* 4 — Ukesrapport, kun Standard */}
          {isStandard && (
            <div style={card}>
              <p style={stepLabel}>Valgfritt</p>
              <p style={heading}>Ukentlig rapport på e-post</p>
              <p style={{ ...bodyText, marginBottom: 16 }}>
                Du får en oppsummering av uken: hvem som deltok, hvem som vant og
                utviklingen over tid. Velg når den skal komme.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {([
                  { value: 'after_quiz', label: 'Rett etter quizen stenger' },
                  { value: 'saturday_morning', label: 'Lørdag morgen' },
                  { value: 'monday_morning', label: 'Mandag morgen' },
                ] as const).map(({ value, label }) => (
                  <RadioRow
                    key={value}
                    selected={reportTiming === value}
                    onSelect={() => setReportTiming(value)}
                    title={label}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 5 — Avslutning */}
          <div style={{ marginTop: 28 }}>
            {error && <div style={welcomeErrorBox}>{error}</div>}

            <button
              onClick={save}
              disabled={!canSubmit}
              style={welcomePrimaryButton(!canSubmit)}
            >
              {saving ? 'Lagrer …' : 'Lagre og gå til bedriftspanelet →'}
            </button>

            {(allowGlobal === null || timeChoice === null) && (
              <p style={{ ...hintText, textAlign: 'center', marginTop: 12 }}>
                Svar på begge valgene over for å fortsette.
              </p>
            )}

            <p style={{ ...hintText, textAlign: 'center', marginTop: 12 }}>
              Alt kan endres senere i bedriftspanelet.
            </p>
          </div>
    </WelcomeShell>
  )
}
