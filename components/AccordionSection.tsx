'use client'

import { useState } from 'react'

const items = [
  {
    title: 'Slik fungerer quizen',
    teaser: 'Svar raskt, klatre på topplisten.',
    content: 'Ny quiz hver fredag med ti spørsmål. Du har begrenset tid per spørsmål — jo raskere du svarer riktig, desto høyere plassering. Etter quizen ser du nøyaktig score og rangering blant alle deltakerne.',
  },
  {
    title: 'Hva er en liga?',
    teaser: 'Konkurrer mot folk du kjenner.',
    content: 'En privat liga lar deg konkurrere mot venner, familie eller kolleger uke etter uke. Opprett en liga, del invitasjonslenken, og alle kan bli med. Poengsummene samles over tid, og ligaen viser hvem som leder.',
  },
  {
    title: 'Gratis eller Premium?',
    teaser: 'Du kan alltid spille gratis.',
    content: 'Alle kan spille gratis — ingen konto nødvendig. Med gratis konto huskes du på topplisten med nøyaktig plassering. Premium (kr 49/mnd) gir deg quizhistorikk, statistikk, private ligaer og mer. Prøv gratis i én måned — ingen kortinfo nødvendig.',
  },
]

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="14"
    height="9"
    viewBox="0 0 14 9"
    fill="none"
    style={{
      flexShrink: 0,
      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.25s ease-in-out',
    }}
  >
    <path d="M1 1L7 7.5L13 1" stroke="#7a7873" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function AccordionSection() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <>
      <style>{`
        .qk-acc-item {
          background: #21242e;
          border: 1px solid #2a2d38;
          border-radius: 16px;
          margin-bottom: 8px;
          overflow: hidden;
          transition: background 0.15s, border-color 0.15s;
        }
        .qk-acc-item:hover {
          background: #242731;
          border-color: #333646;
        }
        .qk-acc-body {
          overflow: hidden;
          transition: max-height 250ms ease-in-out;
        }
      `}</style>
      {items.map((item, i) => {
        const isOpen = open === i
        return (
          <div key={i} className="qk-acc-item">
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '16px 20px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: "'Instrument Sans', sans-serif",
                textAlign: 'left',
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#ffffff', marginBottom: 4 }}>
                  {item.title}
                </div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: '#7a7873',
                  maxHeight: isOpen ? '0' : '22px',
                  overflow: 'hidden',
                  transition: isOpen
                    ? 'opacity 200ms ease, max-height 0ms linear 200ms'
                    : 'max-height 0ms linear, opacity 200ms ease',
                  opacity: isOpen ? 0 : 1,
                }}>
                  {item.teaser}
                </div>
              </div>
              <Chevron open={isOpen} />
            </button>
            <div
              className="qk-acc-body"
              style={{ maxHeight: isOpen ? '300px' : '0' }}
            >
              <div style={{ padding: '0 20px 18px', fontSize: 14, color: '#e8e4dd', lineHeight: 1.65 }}>
                {item.content}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
