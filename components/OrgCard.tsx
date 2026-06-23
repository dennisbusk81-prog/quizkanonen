'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type OrgEntry = { orgId: string; orgName: string; orgSlug: string; isAdmin: boolean }
type Top3Entry = { displayName: string; totalPoints: number }
type Placement = { rank: number | null; total: number; quizTitle: string }

const medals = ['🥇', '🥈', '🥉']

function truncateName(name: string) {
  return name.length > 22 ? name.slice(0, 22) + '…' : name
}

export default function OrgCard() {
  const [org, setOrg] = useState<OrgEntry | null>(null)
  const [top3, setTop3] = useState<Top3Entry[]>([])
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load(accessToken: string) {
      const orgsRes = await fetch('/api/org/my-orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      }).then(r => r.json()).catch(() => ({ orgs: [] }))

      const orgs: OrgEntry[] = orgsRes.orgs ?? []
      if (orgs.length === 0 || cancelled) return

      const first = orgs[0]
      const [summaryRes, placementRes] = await Promise.all([
        fetch(`/api/org/${first.orgSlug}/season-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: accessToken }),
        }).then(r => r.json()).catch(() => ({ top3: [] })),
        fetch(`/api/org/${first.orgSlug}/my-placement`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(r => r.ok ? r.json() : null).catch(() => null),
      ])

      if (cancelled) return
      setOrg(first)
      setTop3(summaryRes.top3 ?? [])

      // Brukerens plassering i siste quiz med org-aktivitet — diskret linje.
      // placement=null: ingen quiz-aktivitet ennå → vis ingenting.
      // placement.rank=null: quiz finnes, brukeren spilte ikke → vis melding.
      if (placementRes?.placement !== undefined) {
        setPlacement(placementRes.placement)
      }

      setLoaded(true)
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return
      if (!session?.access_token) return
      load(session.access_token)
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  if (!loaded || !org) return null

  return (
    <div style={{
      marginTop: 12,
      background: '#21242e',
      border: '1px solid #2a2d38',
      borderRadius: 16,
      padding: '20px 24px',
    }}>
      <p style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: '#c9a84c', marginBottom: 6,
      }}>
        Din arbeidsplass
      </p>
      <p style={{
        fontFamily: "'Libre Baskerville', serif",
        fontSize: 18, fontWeight: 700, color: '#ffffff',
        marginBottom: placement ? 4 : 14, letterSpacing: '-0.01em',
      }}>
        {org.orgName}
      </p>

      {placement && (
        placement.rank != null ? (
          <p style={{ fontSize: 13, color: '#e8e4dd', marginBottom: 14, lineHeight: 1.5 }}>
            Du var {placement.rank} av {placement.total} i {placement.quizTitle}
          </p>
        ) : (
          <p style={{ fontSize: 13, color: '#7a7873', marginBottom: 14, lineHeight: 1.5 }}>
            Du spilte ikke ukens quiz
          </p>
        )
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {top3.map((entry, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15 }}>{medals[i]}</span>
              <span style={{ fontSize: 13, color: '#e8e4dd' }}>{truncateName(entry.displayName)}</span>
            </div>
            <span style={{ fontSize: 13, color: '#7a7873', whiteSpace: 'nowrap' }}>
              {entry.totalPoints} poeng
            </span>
          </div>
        ))}
      </div>

      <a href={`/org/${org.orgSlug}`} style={{
        fontSize: 13, color: '#e8e4dd', textDecoration: 'none',
      }}>
        Se bedriftens toppliste →
      </a>
    </div>
  )
}
