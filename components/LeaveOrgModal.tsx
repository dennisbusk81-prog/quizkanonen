'use client'

import { useState } from 'react'

// Delt bekreftelsesmodal for «Forlat organisasjon». Brukes fra BÅDE
// bedriftspanelet (org/[slug]/admin), medlemssiden (org/[slug]) og låseskjermen
// (OrgLockedScreen) — én implementasjon, slik at de tre ikke driver fra
// hverandre slik innloggingen gjorde før AuthForm.
//
// Følger samme modal-skall som «Avslutt bedriftskonto» i bedriftspanelet:
// samme overlay, samme kort, samme knapperad. Ingen window.confirm().
//
// Til forskjell fra sletting kreves ingen innskrevet bekreftelsesord: å forlate
// er reversibelt (man kan inviteres inn igjen), mens sletting ikke er det.

type Props = {
  orgName: string
  orgSlug: string
  accessToken: string
  /** Vises i stedet for handlingen når vi VET at brukeren er eneste admin. */
  isLastAdmin?: boolean
  onClose: () => void
  /** Kalles etter bekreftet utmelding. Utelatt → naviger til forsiden. */
  onLeft?: () => void
}

const LAST_ADMIN_TEXT =
  'Du er eneste administrator. Utpek en ny admin først, eller slett organisasjonen om den ikke lenger skal brukes.'

export default function LeaveOrgModal({
  orgName,
  orgSlug,
  accessToken,
  isLastAdmin = false,
  onClose,
  onLeft,
}: Props) {
  const [leaving, setLeaving] = useState(false)
  // Forhåndssjekken fra kallstedet er kun et hint. Serverens 409 er fasiten, og
  // overstyrer den her hvis rollene endret seg mens modalen sto åpen.
  const [blocked, setBlocked] = useState(isLastAdmin)
  const [error, setError] = useState<string | null>(null)

  const handleLeave = async () => {
    if (leaving || blocked) return
    setLeaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/org/${orgSlug}/leave`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (data?.code === 'last_admin') {
          setBlocked(true)
          setError(data.error ?? LAST_ADMIN_TEXT)
          return
        }
        setError(data?.error ?? 'Kunne ikke forlate organisasjonen. Prøv igjen.')
        return
      }

      if (onLeft) onLeft()
      else window.location.assign('/?melding=org-forlatt')
    } catch {
      setError('Kunne ikke forlate organisasjonen. Prøv igjen.')
    } finally {
      setLeaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '28px', maxWidth: 420, width: '100%', fontFamily: "'Instrument Sans', sans-serif" }}>

        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#f87171', marginBottom: 10 }}>
          Forlat organisasjon
        </p>

        {blocked ? (
          <>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 16 }}>
              {error ?? LAST_ADMIN_TEXT}
            </p>
            <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6, marginBottom: 20 }}>
              Du gjør en kollega til administrator i medlemslisten i bedriftspanelet. Når det er gjort, kan du forlate herfra.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{ fontSize: 13, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                Lukk
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, color: '#e8e4dd', lineHeight: 1.6, marginBottom: 16 }}>
              Vil du forlate <strong style={{ color: '#ffffff' }}>{orgName}</strong>?
            </p>
            <p style={{ fontSize: 13, color: '#7a7873', lineHeight: 1.6, marginBottom: 20 }}>
              Kontoen din, quizhistorikken og poengene dine beholdes — du fortsetter som vanlig bruker.
              Har du Premium gjennom bedriften, faller den bort med mindre du har egen dekning.
              Du kan bli med igjen hvis du får en ny invitasjon.
            </p>

            {error && (
              <p style={{ fontSize: 13, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, lineHeight: 1.5 }}>
                {error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                disabled={leaving}
                style={{ fontSize: 13, color: '#e8e4dd', background: 'transparent', border: '0.5px solid #2a2d38', borderRadius: 8, padding: '8px 16px', cursor: leaving ? 'not-allowed' : 'pointer', fontFamily: "'Instrument Sans', sans-serif" }}
              >
                Avbryt
              </button>
              <button
                onClick={handleLeave}
                disabled={leaving}
                style={{ fontSize: 13, fontWeight: 600, color: '#1a1c23', background: '#f87171', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: leaving ? 'not-allowed' : 'pointer', opacity: leaving ? 0.6 : 1, fontFamily: "'Instrument Sans', sans-serif" }}
              >
                {leaving ? 'Forlater…' : 'Forlat'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
