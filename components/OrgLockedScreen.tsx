'use client'

import { useState } from 'react'
import Link from 'next/link'
import LeaveOrgModal from '@/components/LeaveOrgModal'

// Vennlig lås-skjerm for org-sider når en B2B-trial er utløpt uten betaling
// (subscription_status === 'locked'). Gater KUN selve org-siden — ansatte kan
// fortsatt spille den ukentlige quizen som vanlig, og ingen data slettes.
// Reaktivering gjenbruker org-checkout (reactivateOrgId) → Stripe checkout.

// ── ROLLEN AVGJØR HVA SOM TILBYS (7. september 2026) ────────────────────────
// «Legg inn betaling →» går til /api/stripe/org-checkout med reactivateOrgId,
// og den ruta avviser alle som ikke er admin med 403 «Ingen admin-tilgang»
// (org-checkout/route.ts:48). Fram til 7. september sto knappen likevel for
// ALLE medlemmer — en ansatt fikk en knapp som garantert feilet. OrgCard på
// forsiden skjuler lenken av nøyaktig den grunnen; samme mønster her. En
// ansatt får i stedet vite hva som skjer og hva hun kan gjøre: en
// administrator må fornye, og hun kan spille som vanlig — løftene under er
// de samme for begge rollene.
export default function OrgLockedScreen({
  orgName,
  orgId,
  orgSlug,
  accessToken,
  isAdmin,
}: {
  orgName: string
  orgId: string
  /** Utelatt → «Forlat organisasjon» skjules (ruten er slug-basert). */
  orgSlug?: string
  accessToken: string
  /** Kun admin kan fornye — ikke-admin får forklaring i stedet for knappen. */
  isAdmin: boolean
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
      <div style={{ minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px', fontFamily: "var(--font-instrument-sans), sans-serif" }}>
        <div style={{ maxWidth: 460, width: '100%', background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '32px 28px', textAlign: 'center' }}>

          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#918f8a', marginBottom: 12 }}>
            {orgName}
          </p>

          <h1 style={{ fontFamily: "var(--font-libre-baskerville), serif", fontSize: 24, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em', marginBottom: 14, lineHeight: 1.3 }}>
            Prøveperioden er over
          </h1>

          <p style={{ fontSize: 15, color: '#e8e4dd', lineHeight: 1.7, marginBottom: 8 }}>
            {isAdmin
              ? 'Bedriftssidene er midlertidig sperret. Legg inn betaling for å fortsette med bedriftens toppliste og admin-panelet.'
              /* ORDLYD FORESLÅTT (Dennis velger): sier hvem som kan handle, og
                 hva som skjer når de gjør det. */
              : `Bedriftssidene er midlertidig sperret. En administrator i ${orgName} må fornye abonnementet før bedriftens toppliste åpner igjen.`}
          </p>
          <p style={{ fontSize: 14, color: '#918f8a', lineHeight: 1.7, marginBottom: 28 }}>
            Ingenting er slettet — profiler, historikk og poeng består. Ansatte kan fortsatt spille den ukentlige quizen som vanlig.
          </p>

          {isAdmin && (
          <button
            onClick={reactivate}
            disabled={loading}
            style={{ background: '#c9a84c', color: '#1a1c23', fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 15, fontWeight: 700, padding: '10px 28px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}
          >
            {loading ? 'Sender…' : 'Legg inn betaling →'}
          </button>
          )}

          {isAdmin && error && (
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
                  fontFamily: "var(--font-instrument-sans), sans-serif", fontSize: 13, fontWeight: 600,
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
