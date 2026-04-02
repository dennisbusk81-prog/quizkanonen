'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import AuthModal from '@/components/AuthModal'
import type { Session } from '@supabase/supabase-js'

export default function UserMenu() {
  const [session, setSession] = useState<Session | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [isPremium, setIsPremium] = useState(false)
  const [subscriptionInfo, setSubscriptionInfo] = useState<{ current_period_end: number | null, cancel_at_period_end: boolean } | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [ready, setReady] = useState(false)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  async function loadProfile(userId: string, fallbackEmail: string | undefined) {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, premium_status')
      .eq('id', userId)
      .maybeSingle()
    setDisplayName(data?.display_name ?? fallbackEmail?.split('@')[0] ?? null)
    setIsPremium(data?.premium_status === true)
    setProfileLoaded(true)
  }

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!isPremium) { setSubscriptionInfo(null); return }
    let cancelled = false
    const timeout = setTimeout(() => { if (!cancelled) setSubscriptionInfo(null) }, 5000)
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled || !s?.access_token) return
      fetch('/api/stripe/subscription', { headers: { 'Authorization': `Bearer ${s.access_token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!cancelled) {
            clearTimeout(timeout)
            setSubscriptionInfo(data ?? null)
          }
        })
        .catch(() => { if (!cancelled) setSubscriptionInfo(null) })
    })
    return () => { cancelled = true; clearTimeout(timeout) }
  }, [isPremium])

  function formatPeriodDate(unix: number): string {
    const d = new Date(unix * 1000)
    const day = d.getDate()
    const month = d.toLocaleDateString('no-NO', { month: 'short' }).replace('.', '')
    const year = d.getFullYear()
    return `${day}. ${month} ${year}`
  }

  async function handlePortal() {
    setPortalLoading(true)
    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      const token = s?.access_token
      if (!token) return
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const data = await res.json()
      console.log('[UserMenu] portal response', res.status, data)
      if (data.url) {
        console.log('[UserMenu] redirecting to', data.url)
        window.open(data.url, '_blank')
      }
    } catch (err) {
      console.error('[UserMenu] portal error', err)
    } finally {
      setPortalLoading(false)
    }
  }

  useEffect(() => {
    // Timeout ensures ready=true even if getSession() hangs during OAuth init
    const timeout = setTimeout(() => setReady(true), 3000)

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      clearTimeout(timeout)
      setSession(s)
      if (s?.user) loadProfile(s.user.id, s.user.email)
      else setProfileLoaded(true)
      setReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setProfileLoaded(false)
      if (s?.user) loadProfile(s.user.id, s.user.email)
      else { setDisplayName(null); setIsPremium(false); setProfileLoaded(true) }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    function onMouseDown(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [dropdownOpen])

  // Don't render until mounted on client, auth state known, and profile loaded
  if (!mounted || !ready || !profileLoaded) return null

  const initial = displayName?.[0]?.toUpperCase() ?? '?'

  return (
    <>
      <div style={{ position: 'fixed', top: 14, right: 18, zIndex: 8000 }}>
        {session ? (
          <div ref={dropdownRef} style={{ position: 'relative' }}>

            {/* Avatar pill */}
            <button
              onClick={() => setDropdownOpen(o => !o)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                background: '#21242e',
                border: '1px solid #2a2d38',
                borderRadius: 999,
                padding: '4px 12px 4px 4px',
                cursor: 'pointer',
                fontFamily: "'Instrument Sans', sans-serif",
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
                fontSize: 11, fontWeight: 700, color: '#c9a84c',
                flexShrink: 0,
              }}>
                {initial}
              </div>
              <span style={{
                fontSize: 13, fontWeight: 500, color: '#9a9590',
                maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {displayName}
              </span>
              <svg
                width="9" height="5" viewBox="0 0 9 5" fill="none"
                style={{ flexShrink: 0, transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
              >
                <path d="M1 1L4.5 4L8 1" stroke="#6a6860" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                background: '#21242e', border: '1px solid #2a2d38',
                borderRadius: 12, padding: 6, minWidth: 170,
                boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
              }}>
                <div style={{
                  padding: '8px 10px 10px',
                  borderBottom: '1px solid #2a2d38',
                  marginBottom: 4,
                }}>
                  <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a6860', marginBottom: 3 }}>
                    Innlogget som
                  </p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: "'Instrument Sans', sans-serif", wordBreak: 'break-all', marginBottom: 6 }}>
                    {displayName}
                  </p>
                  {isPremium ? (
                    <>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.31)', borderRadius: 4, padding: '2px 8px' }}>
                        Premium
                      </span>
                      {mounted && subscriptionInfo?.current_period_end && (
                        <p style={{ fontSize: 11, color: '#6a6860', marginTop: 5 }}>
                          {subscriptionInfo.cancel_at_period_end
                            ? `Avsluttes ${formatPeriodDate(subscriptionInfo.current_period_end)}`
                            : `Fornyes ${formatPeriodDate(subscriptionInfo.current_period_end)}`}
                        </p>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#666', background: 'transparent', border: '1px solid #444', borderRadius: 4, padding: '2px 8px' }}>
                      Standardkonto
                    </span>
                  )}
                </div>
                {isPremium ? (
                  <button
                    onClick={handlePortal}
                    disabled={portalLoading}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 10px', background: 'none', border: 'none',
                      borderRadius: 8, fontSize: 13, color: '#c9a84c',
                      fontFamily: "'Instrument Sans', sans-serif",
                      cursor: portalLoading ? 'default' : 'pointer', transition: 'background 0.12s',
                      opacity: portalLoading ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { if (!portalLoading) e.currentTarget.style.background = 'rgba(201,168,76,0.08)' }}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    {portalLoading ? 'Laster...' : 'Administrer abonnement'}
                  </button>
                ) : (
                  <a
                    href="/premium"
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 10px', background: 'none', border: 'none',
                      borderRadius: 8, fontSize: 13, color: '#c9a84c',
                      fontFamily: "'Instrument Sans', sans-serif",
                      textDecoration: 'none', transition: 'background 0.12s',
                      boxSizing: 'border-box',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(201,168,76,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    Oppgrader til Premium
                  </a>
                )}
                <button
                  onClick={async () => { setDropdownOpen(false); setSession(null); setDisplayName(null); setIsPremium(false); await signOut() }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 10px', background: 'none', border: 'none',
                    borderRadius: 8, fontSize: 13, color: '#f87171',
                    fontFamily: "'Instrument Sans', sans-serif",
                    cursor: 'pointer', transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  Logg ut
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setModalOpen(true)}
            style={{
              background: '#21242e',
              border: '1px solid #2a2d38',
              borderRadius: 999,
              padding: '7px 16px',
              fontSize: 13, fontWeight: 600,
              color: '#9a9590',
              fontFamily: "'Instrument Sans', sans-serif",
              cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.35)'; e.currentTarget.style.color = '#c9a84c' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2d38'; e.currentTarget.style.color = '#9a9590' }}
          >
            Logg inn
          </button>
        )}
      </div>

      <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}
