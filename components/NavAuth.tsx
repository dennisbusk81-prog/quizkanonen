'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import type React from 'react'

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 10px', background: 'none',
  borderRadius: 8, fontSize: 13, color: '#9a9590',
  fontFamily: "'Instrument Sans', sans-serif",
  textDecoration: 'none', transition: 'background 0.12s',
  boxSizing: 'border-box',
}

export default function NavAuth() {
  const [sessionResolved, setSessionResolved] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [isPremium, setIsPremium] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  async function loadProfile(userId: string, fallbackEmail: string | undefined) {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('display_name, premium_status')
        .eq('id', userId)
        .maybeSingle()
      setDisplayName(data?.display_name ?? fallbackEmail?.split('@')[0] ?? null)
      setIsPremium(data?.premium_status === true)
    } catch { /* keep fallback */ }
  }

  useEffect(() => {
    const timeout = setTimeout(() => setSessionResolved(true), 3000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        clearTimeout(timeout)
        if (session?.user) {
          setDisplayName(session.user.email?.split('@')[0] ?? null)
          loadProfile(session.user.id, session.user.email)
        }
        setSessionResolved(true)
      } else if (event === 'SIGNED_OUT') {
        setDisplayName(null)
        setIsPremium(false)
      } else if (session?.user) {
        loadProfile(session.user.id, session.user.email)
      }
    })

    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  // Lukk dropdown ved klikk utenfor
  useEffect(() => {
    if (!dropdownOpen) return
    function onMouseDown(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [dropdownOpen])

  if (!sessionResolved) return null

  if (!displayName) {
    return <Link href="/login" className="qk-nav-login">Logg inn gratis</Link>
  }

  const initial = displayName[0]?.toUpperCase() ?? '?'

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Avatar pill */}
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
          zIndex: 9000,
        }}>
          <a
            href="/profil"
            onClick={() => setDropdownOpen(false)}
            style={menuItemStyle}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            Min profil
          </a>
          <a
            href="/liga"
            onClick={() => setDropdownOpen(false)}
            style={menuItemStyle}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            Mine ligaer
          </a>
          {isPremium && (
            <a
              href="/historikk"
              onClick={() => setDropdownOpen(false)}
              style={menuItemStyle}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              Din quizhistorikk
            </a>
          )}
          <button
            onClick={async () => {
              setDropdownOpen(false)
              setDisplayName(null)
              setIsPremium(false)
              await signOut()
            }}
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
  )
}
