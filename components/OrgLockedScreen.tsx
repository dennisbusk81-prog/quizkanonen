'use client'

import { useState } from 'react'
import Link from 'next/link'
import LeaveOrgModal from '@/components/LeaveOrgModal'

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

// Vennlig lås-skjerm for org-sider når en B2B-trial er utløpt uten betaling
// (subscription_status === 'locked'). Gater KUN selve org-siden — ansatte kan
// fortsatt spille den ukentlige quizen som vanlig, og ingen data slettes.
// Reaktivering gjenbruker org-checkout (reactivateOrgId) → Stripe checkout.

export default function OrgLockedScreen({
  orgName,
  orgId,
  orgSlug,
  accessToken,
}: {
  orgName: string
  orgId: string
  /** Utelatt → «Forlat organisasjon» skjules (ruten er slug-basert). */
  orgSlug?: string
  accessToken: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [leaveModal, setLeaveModal] = useState(false)

  const reactivate = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/stripe/org-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ reactivateOrgId: orgId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Noe gikk galt. Prøv igjen.'); return }
      if (data.url) window.location.href = data.url
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{FONT}</style>
      <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "'Instrument Sans', sans-serif" }}>
        <div style={{ maxWidth: 460, width: '100%', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '32px 28px', textAlign: 'center' }}>

          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 12 }}>
            {orgName}
          </p>

          <h1 style={{ fontFamily: "'Libre Baskerville', serif", fontSize: 24, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 14, lineHeight: 1.3 }}>
            Prøveperioden er over
          </h1>

          <p style={{ fontSize: 15, color: '#e8e4dd', lineHeight: 1.7, marginBottom: 8 }}>
            Bedriftssidene er midlertidig sperret. Legg inn betaling for å fortsette med bedrifts-topplisten og admin-panelet.
          </p>
          <p style={{ fontSize: 14, color: '#918f8a', lineHeight: 1.7, marginBottom: 28 }}>
            Ingenting er slettet — profiler, historikk og poeng består. Ansatte kan fortsatt spille den ukentlige quizen som vanlig.
          </p>

          <button
            onClick={reactivate}
            disabled={loading}
            style={{ background: '#c9a84c', color: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", fontSize: 15, fontWeight: 700, padding: '10px 28px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}
          >
            {loading ? 'Sender…' : 'Legg inn betaling →'}
          </button>

          {error && (
            <div style={{ fontSize: 13, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '10px 14px', marginTop: 18, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          {/* En låst org sperrer hele siden, så uten denne utveien satt et medlem
              fast: de kunne verken bruke bedriften eller melde seg ut av den —
              og en invitasjon fra et nytt sted ble avvist med «du er allerede
              medlem av en organisasjon». */}
          {orgSlug && (
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #2a2d38' }}>
              <p style={{ fontSize: 13, color: '#918f8a', lineHeight: 1.6, marginBottom: 12 }}>
                Skal du ikke være med i {orgName} lenger?
              </p>
              <button
                onClick={() => setLeaveModal(true)}
                style={{
                  background: 'transparent', color: '#e8e4dd',
                  fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, fontWeight: 600,
                  padding: '10px 28px', borderRadius: 10, border: '1px solid #2a2d38',
                  cursor: 'pointer',
                }}
              >
                Forlat organisasjon
              </button>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <Link href="/" style={{ fontSize: 13, color: '#e8e4dd', textDecoration: 'none' }}>← Forsiden</Link>
          </div>

        </div>
      </div>

      {leaveModal && orgSlug && (
        <LeaveOrgModal
          orgName={orgName}
          orgSlug={orgSlug}
          accessToken={accessToken}
          onClose={() => setLeaveModal(false)}
        />
      )}
    </>
  )
}
