'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import AuthModal from '@/components/AuthModal'
import { getAvatarInitial } from '@/lib/avatar-initial'
import { useProfile } from '@/components/ProfileProvider'
import { useActiveQuizId } from '@/components/ActiveQuizProvider'
import { accountMenuGroups, guestMenuLinks, topLinks, type AccountRow, type NavLink } from '@/lib/nav-model'
import type React from 'react'

// ── Topplinjen og kontomenyen (modellen fra 6. september 2026) ──────────────
//
// HVA som står hvor bor i lib/nav-model.ts — rene funksjoner per brukertype,
// testet i lib/nav-model.test.ts. Denne fila rendrer.
//
//   TOPPLINJEN   fire lenker: Spill · Toppliste · For bedrifter/bedriften ·
//                Quizarkiv. Skjules under 899 px (nav-hide-mobile).
//   KONTOMENYEN  innlogget brukers ENESTE meny, på alle bredder: alt som ikke
//                er i topplinjen, gruppert med tynne skillelinjer. Under 899
//                gjentar den topplinjens fire lenker øverst, så ingenting
//                forsvinner når raden gjør det.
//   HAMBURGEREN  finnes KUN for gjest, og kun under 899 px — gjesten har
//                ingen kontomeny, bare «Logg inn» og, når en quiz er åpen,
//                «Spill» som står fast også under 899. Wrapperen er display:none
//                på desktop; fram til 6. september sto den igjen som et tomt
//                flex-barn og kostet én gap (8 px) i raden uten å gjøre noe.
//
// NAVIGASJONSLENKENE ER BEVISST <a>, IKKE <Link>. Full sidelast gir fersk
// server-data ved seksjonsbytte i stedet for Next sin router-cache (som kan
// være opptil 30 s gammel), og rydder samtidig klienttilstand. Vurdert og
// bekreftet under lint-oppryddingen 5. august 2026; en eventuell overgang til
// <Link prefetch={false}> ligger i backloggen og krever manuell test av
// spillestien. Unntaket er «Spill» i topplinjen, som alltid har vært <Link>.
//
// «Spill» peker på quizen som er åpen nå (useActiveQuizId, fra rot-layouten).
// Ingen åpen quiz → ingen lenke; se lib/nav-model.ts for hvorfor.
//
// (Tidligere forsøk brukte overflow-x:auto på .qk-nav-actions som
// sikkerhetsnett for smale skjermer — det satte utilsiktet overflow-y: auto
// også (CSS-spec-oppførsel) og klippet avatar-dropdownens panel. Ingen
// overflow på noen FORELDER av dropdownene; overflow-y på selve panelet
// (maxHeight-scrollen under) er noe annet og klipper ingenting.)
//
// ── HVORFOR GRENSEN ER 899, IKKE 639 (6. september 2026) ────────────────────
// Invarianten Dennis valgte: en bruker skal se ENTEN hele lenkeraden ELLER
// hamburgeren/kontomenyen — aldri en halv rad. Raden har `flex-wrap: nowrap`
// og `flex-shrink: 0` på både logo og lenkegruppe, og ingen forfar setter
// `overflow`, så en rad som ikke får plass brytes ikke og klippes ikke — den
// renner ut til høyre og skyver konto-pillen delvis av skjermen.
//
// `innerStyle` i SiteNav har `max-width: 900`. Under 900 følger beholderen
// viewporten, ved 900 og oppover står den fast på 900 px (860 px innhold).
// 900 er derfor den ENESTE grensen der «får plass ved grensen» også betyr
// «får plass på hver eneste bredere skjerm» — over den endrer ingenting seg.
//
// Målte behov med den nye raden (headless Chrome, webfontene lastet,
// kalibrert mot produksjon 6. september 2026):
//   gjest, åpen quiz                           498
//   innlogget uten bedrift, åpen quiz          588
//   org-medlem (Elkjøp Nordic), åpen quiz      592
//   klemt org-navn + langt brukernavn + quiz   658   ← verste som kan finnes
// Alle under 900 med god margin (admin-lenkene bor i kontomenyen, og en
// bruker med flere bedrifter får bare den første i topplinjen). Dagens rad (før omleggingen) trengte 931
// for en admin i to bedrifter på forsiden med åpen quiz — invarianten holdt
// altså ikke for den profilen, selv om den ikke finnes i prod ennå.
const NAV_MOBILE_CSS = `
  .qk-nav-hamburger { display: none; }
  @media (max-width: 899px) {
    .nav-hide-mobile { display: none !important; }
    .qk-nav-hamburger { display: block !important; }
  }
`

function formatPeriodDate(unix: number): string {
  const d = new Date(unix * 1000)
  const day = d.getDate()
  const month = d.toLocaleDateString('no-NO', { month: 'short' }).replace('.', '')
  const year = d.getFullYear()
  return `${day}. ${month} ${year}`
}

// ── BRUKERSKREVET TEKST I NAV-EN MÅ AVKORTES (6. september 2026) ────────────
// Org-navnet er det ENESTE brukerskrevne som kan havne i navigasjonsraden:
// topplinjens bedrifts-slot bærer navnet, og kontomenyen viser navn per rad
// når brukeren har flere bedrifter. `validateOrgName` tillater 60 tegn, så et
// slikt navn kunne dyttet raden langt forbi hamburgergrensen uansett hvor den
// står. Et høyere brytepunkt kan ikke løse et ubegrenset tall; avkorting kan.
//
// Samme behandling som avatar-navnet i konto-knappen lenger nede: maks-bredde
// + ellipse + nowrap. Ikke et nytt mønster, samme mønster. Verdien er den
// samme (110) av samme grunn.
//
// I kontomenyen sitter klemmen på en INNER span, ikke på menyraden selv —
// `menuItem` er `width: 100%` med padding, så en maks-bredde der ville
// krympet hele den klikkbare raden til 110 px. `display: block` fordi ellipse
// krever en blokkboks; i topplinjen er lenken flex-barn og får det gratis.
const ORG_NAME_MAX_WIDTH = 110
const orgNameClamp: React.CSSProperties = {
  maxWidth: ORG_NAME_MAX_WIDTH,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const menuItem: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', background: 'none',
  borderRadius: 8, fontSize: 13, color: '#e8e4dd',
  fontFamily: "var(--font-instrument-sans), sans-serif",
  textDecoration: 'none', transition: 'background 0.12s',
  boxSizing: 'border-box', whiteSpace: 'nowrap',
}

const menuButton: React.CSSProperties = {
  ...menuItem,
  border: 'none', cursor: 'pointer',
}

// ── Menyene må få plass i viewporten (6. september 2026) ────────────────────
// Kontomenyen er nå innlogget brukers ENESTE meny og har opptil elleve rader
// pluss hode: målt 521 px høy for en org-admin med åpen quiz. På en telefon i
// liggende format (667×375) rakk den 206 px UTENFOR skjermen, og «Logg ut»
// nederst var uklikkbar. Panelet ligger 60 px fra toppen (nav 54 + 6), så
// maks-høyden er resten av viewporten minus 6 px luft; innholdet scroller
// inne i panelet. dvh følger mobilnettleserens adressefelt; nettlesere
// uten dvh-støtte (Safari < 15.4) får ingen maks-høyde — som før.
// Alternativet, et fullskjerm-ark under en viss høyde, er rapportert som
// forslag og ikke valgt her: scroll krever ingen ny flate og ingen ny
// lukkemekanikk.
const dropdownPanel: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
  background: '#21242e', border: '0.5px solid #2a2d38',
  borderRadius: 12, padding: 6, minWidth: 170,
  boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
  zIndex: 9000,
  maxHeight: 'calc(100dvh - 66px)', overflowY: 'auto',
}

const menuDivider: React.CSSProperties = { height: '0.5px', background: '#2a2d38', margin: '4px 6px' }

const navLink: React.CSSProperties = {
  fontSize: 13, color: '#e8e4dd', textDecoration: 'none',
  fontFamily: "var(--font-instrument-sans), sans-serif", whiteSpace: 'nowrap',
}

const toplisteLinkStyle: React.CSSProperties = {
  ...navLink, fontSize: 14,
}

const spillLinkStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600,
  color: '#e8e4dd', background: 'transparent',
  textDecoration: 'none', padding: '6px 14px',
  borderRadius: 10, border: '1px solid #918f8a',
  whiteSpace: 'nowrap', fontFamily: "var(--font-instrument-sans), sans-serif",
  transition: 'border-color 0.15s, color 0.15s',
}

const premiumBadge: React.CSSProperties = {
  marginLeft: 8, fontSize: 10, fontWeight: 700,
  letterSpacing: '0.1em', textTransform: 'uppercase',
  color: '#c9a84c', background: 'rgba(201,168,76,0.1)',
  border: '1px solid rgba(201,168,76,0.2)',
  borderRadius: 999, padding: '2px 8px',
}

function hoverBg(e: React.MouseEvent<HTMLElement>, bg: string) {
  e.currentTarget.style.background = bg
}

/**
 * Én topplinje-lenke. Stilen følger nøkkelen: Spill er outline-knapp,
 * Toppliste 14 px, org-navn klemt. `alwaysVisible` holder lenken synlig
 * også under 899 — brukes KUN for gjestens «Spill» (se lib/nav-model.ts).
 */
function TopLink({ link, alwaysVisible = false }: { link: NavLink; alwaysVisible?: boolean }) {
  if (link.key === 'spill') {
    return (
      <Link href={link.href} className={alwaysVisible ? undefined : 'nav-hide-mobile'} style={spillLinkStyle}>
        {link.label}
      </Link>
    )
  }
  const style = link.key === 'toppliste'
    ? toplisteLinkStyle
    : link.clamp ? { ...navLink, ...orgNameClamp } : navLink
  return (
    <a href={link.href} className="nav-hide-mobile" style={style}>
      {link.label}
    </a>
  )
}

/** Én menyrad (hamburger eller kontomeny). */
function MenuRow({ link, onClick }: { link: NavLink & { badge?: 'premium' }; onClick: () => void }) {
  return (
    <a
      href={link.href}
      onClick={onClick}
      style={menuItem}
      onMouseEnter={e => hoverBg(e, '#262930')}
      onMouseLeave={e => hoverBg(e, 'none')}
    >
      {link.clamp ? <span style={{ ...orgNameClamp, display: 'block' }}>{link.label}</span> : link.label}
      {link.badge === 'premium' && <span style={premiumBadge}>Premium</span>}
    </a>
  )
}

export default function NavAuth() {
  const pathname = usePathname()
  const activeQuizId = useActiveQuizId()
  // All profil-/premium-/org-tilstand kommer fra delt context (ProfileProvider).
  const { userId, displayName, isPremium, hasStripeCustomer, hasUsedTrial, myOrgs, loading, resolved } = useProfile()
  const isLoggedIn = userId !== null
  const sessionResolved = resolved
  const profileLoaded = !loading

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  // Gjestens hamburger. Egen state/ref fra kontomenyen: de finnes aldri
  // samtidig (gjest har kun hamburger, innlogget kun kontomeny), men deler
  // heller ikke livssyklus.
  const [hamburgerOpen, setHamburgerOpen] = useState(false)
  const hamburgerRef = useRef<HTMLDivElement>(null)

  // Fornyelses-/avslutningsdatoen i dropdown-hodet. Hentes LAZY — først når
  // dropdownen faktisk åpnes, og høyst én gang per montering. Datoen er bare
  // synlig inne i den åpne dropdownen, så mount-henting var ren sløsing.
  const [subscriptionInfo, setSubscriptionInfo] = useState<{ current_period_end: number | null, cancel_at_period_end: boolean } | null>(null)
  const subscriptionRequested = useRef(false)
  // Skiller unmount fra dropdown-lukking: effekten under har med vilje INGEN
  // cleanup, ellers ville en rask åpne-lukk kastet svaret underveis og
  // subscriptionRequested sperret for nytt forsøk — datoen ville da aldri
  // vist seg resten av sidelasten.
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (!dropdownOpen || !isPremium || subscriptionRequested.current) return
    subscriptionRequested.current = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!alive.current || !session?.access_token) return
      fetch('/api/stripe/subscription', { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (alive.current) setSubscriptionInfo(data ?? null) })
        .catch(() => { /* datoen er tilleggsinfo — feiler kallet, vises bare merket */ })
    }).catch(() => { /* samme: hodet rendrer fint uten dato */ })
  }, [dropdownOpen, isPremium])

  async function handlePortal() {
    if (portalLoading) return
    setPortalError(null)
    const win = window.open('', '_blank')
    setPortalLoading(true)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { win?.close(); setPortalError('Ikke innlogget'); return }
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      const data = await res.json()
      if (data.url) {
        if (win) win.location.href = data.url
        else window.open(data.url, '_blank')
      } else {
        win?.close()
        setPortalError(data.error ?? 'Noe gikk galt')
      }
    } catch (err) {
      win?.close()
      setPortalError((err as Error).name === 'AbortError'
        ? 'Forespørselen tok for lang tid. Prøv igjen.'
        : 'Noe gikk galt. Prøv igjen.')
    } finally {
      clearTimeout(timeout)
      setPortalLoading(false)
    }
  }

  useEffect(() => {
    if (!dropdownOpen) setPortalError(null)
  }, [dropdownOpen])

  useEffect(() => {
    if (!dropdownOpen) return
    function onMouseDown(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [dropdownOpen])

  useEffect(() => {
    if (!hamburgerOpen) return
    function onMouseDown(e: MouseEvent) {
      if (!hamburgerRef.current?.contains(e.target as Node)) setHamburgerOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [hamburgerOpen])

  if (!sessionResolved) return null

  const navInput = { loggedIn: isLoggedIn, activeQuizId, pathname, myOrgs }
  const topplinje = topLinks(navInput)

  // ── Not logged in ──
  if (!isLoggedIn) {
    return (
      <>
        <style>{NAV_MOBILE_CSS}</style>
        {/* Gjestens «Spill» står fast også under 899: en fremmed fra en delt
            lenke skal se veien til quizen uten å åpne en meny. Målt: raden
            trenger 326 px med den, får plass på 375. */}
        {topplinje.map(l => <TopLink key={l.key} link={l} alwaysVisible={l.key === 'spill'} />)}

        {/* Hamburger — gjestens eneste meny, kun under 899 px. */}
        <div ref={hamburgerRef} className="qk-nav-hamburger" style={{ position: 'relative' }}>
          <button
            onClick={() => setHamburgerOpen(o => !o)}
            aria-label="Meny"
            aria-expanded={hamburgerOpen}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 34, height: 34, background: 'transparent',
              border: '1px solid #2a2d38', borderRadius: 10,
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
              <path d="M1 1H15M1 6H15M1 11H15" stroke="#e8e4dd" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          {hamburgerOpen && (
            <div style={dropdownPanel}>
              {guestMenuLinks(navInput).map(l => (
                <MenuRow key={l.key} link={l} onClick={() => setHamburgerOpen(false)} />
              ))}
            </div>
          )}
        </div>

        {/* Identitetsknapp — "din konto". Samme posisjon som avatar-pillen
            for innlogget bruker (se under), alltid synlig, aldri gjemt i
            hamburgeren.

            Åpner AuthModal i stedet for å navigere til /login: innlogging
            uten å forlate siden brukeren står på. Unntak på selve /login — en
            modal oppå innloggingssiden gir ingen mening, der beholdes
            lenke-atferden. */}
        {pathname === '/login' ? (
          <a href="/login" style={navLink}>Logg inn</a>
        ) : (
          <button
            onClick={() => setAuthModalOpen(true)}
            style={{
              ...navLink, background: 'none',
              border: 'none', padding: 0, cursor: 'pointer',
            }}
          >
            Logg inn
          </button>
        )}
        <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      </>
    )
  }

  const initial = getAvatarInitial(displayName)
  const grupper = accountMenuGroups({ ...navInput, profileLoaded, isPremium, hasStripeCustomer, hasUsedTrial })

  function renderRow(row: AccountRow) {
    if (row.kind === 'portal') {
      return (
        <div key={row.key}>
          <button
            onClick={handlePortal}
            style={menuButton}
            onMouseEnter={e => hoverBg(e, '#262930')}
            onMouseLeave={e => hoverBg(e, 'none')}
          >
            {portalLoading ? 'Åpner…' : row.label}
          </button>
          {portalError && (
            <p style={{ fontSize: 11, color: '#f87171', padding: '0 10px 8px', margin: 0, lineHeight: 1.4 }}>
              {portalError}
            </p>
          )}
        </div>
      )
    }
    return <MenuRow key={row.key} link={row} onClick={() => setDropdownOpen(false)} />
  }

  // ── Logged in ──
  return (
    <>
      <style>{NAV_MOBILE_CSS}</style>
      {topplinje.map(l => <TopLink key={l.key} link={l} />)}

      {/* Identitetsknapp — "din konto", samme posisjon som "Logg inn" hos
          gjest. Dropdownen under er innlogget brukers ENESTE meny. */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen(o => !o)}
          aria-expanded={dropdownOpen}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: '#21242e', border: '1px solid #2a2d38',
            borderRadius: 999, padding: '4px 12px 4px 4px',
            cursor: 'pointer', fontFamily: "var(--font-instrument-sans), sans-serif",
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(201,168,76,0.3)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#2a2d38'}
        >
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: 'rgba(201,168,76,0.12)',
            border: '1.5px solid rgba(201,168,76,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#c9a84c', flexShrink: 0,
          }}>
            {initial}
          </div>
          <span style={{
            fontSize: 13, fontWeight: 500, color: '#e8e4dd',
            maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayName}
          </span>
          <svg
            width="9" height="5" viewBox="0 0 9 5" fill="none"
            style={{ flexShrink: 0, transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
          >
            <path d="M1 1L4.5 4L8 1" stroke="#918f8a" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {dropdownOpen && (
          <div className="qk-account-menu" style={dropdownPanel}>
            {/* Kontohodet — «Innlogget som», Premium-/Gratis-merket og
                fornyelsesdatoen. profileLoaded-gaten på merket hindrer at en
                Premium-bruker ser «Gratis» i blaffet før profilen har landet;
                navnet over gaten vises med én gang. */}
            <div style={{
              padding: '8px 10px 10px',
              borderBottom: '0.5px solid #2a2d38',
              marginBottom: 4,
            }}>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 3 }}>
                Innlogget som
              </p>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: "var(--font-instrument-sans), sans-serif", wordBreak: 'break-all', marginBottom: 6 }}>
                {displayName}
              </p>
              {profileLoaded && (isPremium ? (
                <>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.31)', borderRadius: 4, padding: '2px 8px' }}>
                    Premium
                  </span>
                  {subscriptionInfo?.current_period_end && (
                    <p style={{ fontSize: 11, color: '#918f8a', marginTop: 5 }}>
                      {subscriptionInfo.cancel_at_period_end
                        ? `Avsluttes ${formatPeriodDate(subscriptionInfo.current_period_end)}`
                        : `Fornyes ${formatPeriodDate(subscriptionInfo.current_period_end)}`}
                    </p>
                  )}
                </>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 400, color: '#918f8a', background: 'transparent', border: '1px solid #2a2d38', borderRadius: 4, padding: '2px 8px' }}>
                  Gratis
                </span>
              ))}
            </div>

            {/* Gruppene fra lib/nav-model.ts, skilt med tynne linjer. */}
            {grupper.map((gruppe, i) => (
              <div key={i}>
                {i > 0 && <div style={menuDivider} />}
                {gruppe.map(renderRow)}
              </div>
            ))}

            <div style={menuDivider} />
            {signOutError && (
              <p style={{ fontSize: 11, color: '#f87171', padding: '0 10px 6px', margin: 0, lineHeight: 1.4 }}>
                {signOutError}
              </p>
            )}
            <button
              onClick={async () => {
                setDropdownOpen(false)
                setSignOutError(null)
                try {
                  await signOut()
                  // signOut() redirects on success — state cleared by SIGNED_OUT event
                } catch {
                  setSignOutError('Utlogging feilet — prøv igjen')
                  setTimeout(() => setSignOutError(null), 4000)
                }
              }}
              style={{ ...menuButton, color: '#f87171' }}
              onMouseEnter={e => hoverBg(e, 'rgba(248,113,113,0.08)')}
              onMouseLeave={e => hoverBg(e, 'none')}
            >
              Logg ut
            </button>
          </div>
        )}
      </div>
    </>
  )
}
