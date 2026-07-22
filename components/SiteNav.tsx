'use client'

import Link from 'next/link'
import NavAuth from '@/components/NavAuth'
import type React from 'react'

// ── Én delt toppnav for hele produktet ───────────────────────────────────────
// Erstatter tidligere 7 ulike nav-varianter (egendefinert qk-nav+NavAuth på
// forside/liga, egendefinert org-nav med ulik ordlyd på /org/[slug] vs.
// /org/[slug]/admin, virkningsløse UserMenuWrapper-kall, spredte inline
// "← Tilbake"-lenker) samt de to usynkroniserte globale unntakslistene i
// components/UserMenu.tsx og components/BackNav.tsx.
//
// Skallet (sticky bar, logo/tilbake-område, NavAuth-lenkerad) er identisk på
// tvers av alle varianter — kun venstre-siden endres:
//  - default:    "Quizkanonen"-logo → "/"
//  - org:        "← Tilbake til bedriften" → /org/{orgSlug}
//  - org-admin:  samme tilbake-lenke + bedriftsnavn + lite "ADMIN"-merke
//
// Mobil kollapser NavAuths lenkerad til hamburger — ren responsiv
// sammenslåing, ikke en egen variant (se NAV_MOBILE_CSS i NavAuth.tsx).

type SiteNavVariant = 'default' | 'org' | 'org-admin'

interface SiteNavProps {
  variant?: SiteNavVariant
  orgSlug?: string
  orgName?: string
  quizId?: string
}

const barStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 100,
  background: 'rgba(26,28,35,0.95)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderBottom: '1px solid #2a2d38',
}

const innerStyle: React.CSSProperties = {
  maxWidth: 900,
  margin: '0 auto',
  padding: '0 20px',
  height: 54,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

export default function SiteNav({ variant = 'default', orgSlug, orgName, quizId }: SiteNavProps) {
  return (
    <nav style={barStyle}>
      <div style={innerStyle}>
        {/* ── Venstre: logo (default) eller tilbake-til-bedrift (org/org-admin) ── */}
        {variant === 'default' && (
          <Link
            href="/"
            style={{
              fontFamily: "'Libre Baskerville', serif", fontSize: 17, fontWeight: 700,
              color: '#ffffff', textDecoration: 'none', flexShrink: 0,
            }}
          >
            Quiz<em style={{ fontStyle: 'italic', color: '#c9a84c' }}>kanonen</em>
          </Link>
        )}

        {(variant === 'org' || variant === 'org-admin') && orgSlug && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden' }}>
            <Link
              href={`/org/${orgSlug}`}
              style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none', flexShrink: 0 }}
            >
              ← Tilbake til bedriften
            </Link>
            {variant === 'org-admin' && orgName && (
              <>
                <span style={{ width: 1, height: 16, background: '#2a2d38', flexShrink: 0 }} />
                <span style={{
                  fontSize: 13, color: '#e8e4dd', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}>
                  {orgName}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.28)',
                  borderRadius: 999, padding: '2px 8px', flexShrink: 0,
                }}>
                  Admin
                </span>
              </>
            )}
          </div>
        )}

        {/* ── Høyre: full lenkerad + hamburger (mobil) + konto-meny ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <NavAuth quizId={quizId} />
        </div>
      </div>
    </nav>
  )
}
