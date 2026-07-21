'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import { getAvatarInitial } from '@/lib/avatar-initial'
import type React from 'react'

// nav-hide-mobile brukes fortsatt for Min bedrift/Bedriftspanel (urørt).
// Sesongtoppliste og For bedrifter var tidligere skjult under 640px med
// samme klasse, uten noen erstatning — gjester på mobil hadde ingen vei til
// dem i det hele tatt. De har nå fått klassen fjernet (se JSX under), og
// .qk-nav-actions scroller horisontalt på smale skjermer i stedet for å
// overflowe eller klippes: raden (logo + alle synlige lenker + evt.
// "Spill ukens quiz"-pillen) er regnemessig bredere enn tilgjengelig plass
// på en 375px-skjerm selv uten pillen. min-width: 0 er nødvendig for at
// flex-elementet skal få lov til å krympe under innholdets naturlige
// bredde — uten den ville .qk-nav-actions bare presset hele
// navigasjonslinjen bredere i stedet for å scrolle internt.
const NAV_MOBILE_CSS = `
  @media (max-width: 639px) {
    .nav-hide-mobile { display: none !important; }
    .qk-nav-actions {
      min-width: 0;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .qk-nav-actions::-webkit-scrollbar { display: none; }
  }
`

const menuItem: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', background: 'none',
  borderRadius: 8, fontSize: 13, color: '#e8e4dd',
  fontFamily: "'Instrument Sans', sans-serif",
  textDecoration: 'none', transition: 'background 0.12s',
  boxSizing: 'border-box', whiteSpace: 'nowrap',
}

export default function NavAuth({ quizId }: { quizId?: string }) {
  const [sessionResolved, setSessionResolved] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [isPremium, setIsPremium] = useState(false)
  const [hasStripeCustomer, setHasStripeCustomer] = useState(false)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [myOrgs, setMyOrgs] = useState<{ orgId: string; orgName: string; orgSlug: string; isAdmin: boolean; allowGlobalLeague: boolean }[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  async function loadProfile(userId: string, fallbackEmail: string | undefined, accessToken?: string) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle()
      setDisplayName(data?.display_name ?? null)
    } catch { /* keep fallback */ }
    // Premium: hent server-side for å omgå RLS
    if (accessToken) {
      try {
        const premRes = await fetch('/api/profile/premium-status', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (premRes.ok) {
          const premData = await premRes.json()
          setIsPremium(premData.isPremium === true)
          setHasStripeCustomer(premData.hasStripeCustomer === true)
        }
      } catch { /* fallback: not premium */ }
    }
    setProfileLoaded(true)
  }

  async function fetchMyOrgs(accessToken: string) {
    try {
      const res = await fetch('/api/org/my-orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      })
      const json = res.ok ? await res.json() : { orgs: [] }
      setMyOrgs(json.orgs ?? [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const timeout = setTimeout(() => setSessionResolved(true), 3000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
        clearTimeout(timeout)
        if (session?.user) {
          setIsLoggedIn(true)
          loadProfile(session.user.id, session.user.email, session.access_token)
          if (session.access_token) fetchMyOrgs(session.access_token)
        } else {
          setIsLoggedIn(false)
          setProfileLoaded(true)
        }
        setSessionResolved(true)
      } else if (event === 'SIGNED_IN') {
        if (session?.user) {
          setIsLoggedIn(true)
          loadProfile(session.user.id, session.user.email, session.access_token)
          if (session.access_token) fetchMyOrgs(session.access_token)
        }
      } else if (event === 'SIGNED_OUT') {
        setIsLoggedIn(false)
        setDisplayName(null)
        setIsPremium(false)
        setMyOrgs([])
        setProfileLoaded(true)
      }
    })

    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

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

  if (!sessionResolved) return null

  const navLink: React.CSSProperties = {
    fontSize: 13, color: '#e8e4dd', textDecoration: 'none',
    fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap',
  }

  const toplisteLinkStyle: React.CSSProperties = {
    fontSize: 14, color: '#e8e4dd', textDecoration: 'none',
    fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap',
  }

  // ── Not logged in ──
  if (!isLoggedIn) {
    return (
      <>
        <style>{NAV_MOBILE_CSS}</style>
        <a href="/toppliste" style={toplisteLinkStyle} className="qk-nav-toppliste">Sesongtoppliste</a>
        <a href="/bedrift" style={navLink}
          onMouseEnter={e => e.currentTarget.style.color = '#e8e4dd'}
          onMouseLeave={e => e.currentTarget.style.color = '#e8e4dd'}
        >For bedrifter</a>
        <a href="/login" style={{ ...navLink, color: '#e8e4dd' }}>Logg inn</a>
        {quizId && (
          <Link
            href={`/quiz/${quizId}`}
            style={{
              fontSize: 13, fontWeight: 600,
              color: '#e8e4dd', background: 'transparent',
              textDecoration: 'none', padding: '6px 14px',
              borderRadius: 10, border: '1px solid #7a7873',
              whiteSpace: 'nowrap', fontFamily: "'Instrument Sans', sans-serif",
              transition: 'border-color 0.15s, color 0.15s',
            }}
          >
            Spill ukens quiz →
          </Link>
        )}
      </>
    )
  }

  const initial = getAvatarInitial(displayName)

  const globalHidden = myOrgs.length > 0 && myOrgs.some(o => !o.allowGlobalLeague)

  // ── Logged in ──
  return (
    <>
      <style>{NAV_MOBILE_CSS}</style>
      <a href="/" style={{ fontSize: 14, color: '#e8e4dd', textDecoration: 'none', fontFamily: "'Instrument Sans', sans-serif", whiteSpace: 'nowrap' as const }}>Hjem</a>
      {!globalHidden && <a href="/toppliste" style={toplisteLinkStyle} className="qk-nav-toppliste">Sesongtoppliste</a>}
      {/* Min bedrift — for all org members */}
      {myOrgs.length > 0 && (
        <a
          href={`/org/${myOrgs[0].orgSlug}`}
          style={navLink}
          className="nav-hide-mobile"
          onMouseEnter={e => e.currentTarget.style.color = '#e8e4dd'}
          onMouseLeave={e => e.currentTarget.style.color = '#e8e4dd'}
        >
          Min bedrift
        </a>
      )}
      {/* Bedriftspanel — only for org admins */}
      {myOrgs.some(o => o.isAdmin) && (
        <a
          href={`/org/${myOrgs.find(o => o.isAdmin)!.orgSlug}/admin`}
          style={navLink}
          className="nav-hide-mobile"
          onMouseEnter={e => e.currentTarget.style.color = '#e8e4dd'}
          onMouseLeave={e => e.currentTarget.style.color = '#e8e4dd'}
        >
          Bedriftspanel
        </a>
      )}
      <a href="/bedrift" style={navLink}
        onMouseEnter={e => e.currentTarget.style.color = '#e8e4dd'}
        onMouseLeave={e => e.currentTarget.style.color = '#e8e4dd'}
      >For bedrifter</a>

      {/* Avatar pill + dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: '#21242e', border: '1px solid #2a2d38',
            borderRadius: 999, padding: '4px 12px 4px 4px',
            cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif",
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
            <path d="M1 1L4.5 4L8 1" stroke="#7a7873" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            background: '#21242e', border: '0.5px solid #2a2d38',
            borderRadius: 12, padding: 6, minWidth: 170,
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
            zIndex: 9000,
          }}>
            <a
              href="/profil"
              onClick={() => setDropdownOpen(false)}
              style={menuItem}
              onMouseEnter={e => e.currentTarget.style.background = '#262930'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              Min profil
            </a>
            <a
              href="/liga"
              onClick={() => setDropdownOpen(false)}
              style={menuItem}
              onMouseEnter={e => e.currentTarget.style.background = '#262930'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              Mine ligaer
            </a>
            {myOrgs.length > 0 && (
              <a
                href={`/org/${myOrgs[0].orgSlug}`}
                onClick={() => setDropdownOpen(false)}
                style={menuItem}
                onMouseEnter={e => e.currentTarget.style.background = '#262930'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                Min bedrift
              </a>
            )}
            {!globalHidden && (
              <a
                href="/toppliste"
                onClick={() => setDropdownOpen(false)}
                style={menuItem}
                onMouseEnter={e => e.currentTarget.style.background = '#262930'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                Sesong-topplisten →
              </a>
            )}
            {isPremium && (
              <a
                href="/historikk"
                onClick={() => setDropdownOpen(false)}
                style={menuItem}
                onMouseEnter={e => e.currentTarget.style.background = '#262930'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                Quizhistorikk
              </a>
            )}
            {profileLoaded && isPremium && (
              <>
                {!hasStripeCustomer ? (
                  <div style={{ padding: '6px 10px 10px', borderTop: '0.5px solid #2a2d38', marginTop: 4 }}>
                    <p style={{ fontSize: 11, color: '#e8e4dd', lineHeight: 1.5, marginBottom: 6 }}>
                      Du har gratis Premium-tilgang. Abonnementsadministrasjon er tilgjengelig når du tegner et betalt abonnement.
                    </p>
                    <a
                      href="/premium"
                      onClick={() => setDropdownOpen(false)}
                      style={{ fontSize: 11, color: '#e8e4dd', textDecoration: 'underline' }}
                    >
                      Se Premium-funksjoner →
                    </a>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handlePortal}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 10px', background: 'none', border: 'none',
                        borderRadius: 8, fontSize: 13, color: '#c9a84c',
                        fontFamily: "'Instrument Sans', sans-serif",
                        cursor: 'pointer', transition: 'background 0.12s', whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#262930'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      Mitt abonnement
                    </button>
                    {portalError && (
                      <p style={{ fontSize: 11, color: '#f87171', padding: '0 10px 8px', margin: 0, lineHeight: 1.4 }}>
                        {portalError}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
            <div style={{ height: '0.5px', background: '#2a2d38', margin: '4px 6px' }} />
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
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 10px', background: 'none', border: 'none',
                borderRadius: 8, fontSize: 13, color: '#f87171',
                fontFamily: "'Instrument Sans', sans-serif",
                cursor: 'pointer', transition: 'background 0.12s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              Logg ut
            </button>
          </div>
        )}
      </div>
    </>
  )
}
