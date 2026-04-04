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

export default function AccordionSection() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div>
      {items.map((item, i) => {
        const isOpen = open === i
        return (
          <div
            key={i}
            style={{
              background: '#21242e',
              border: '1px solid #2a2d38',
              borderRadius: 14,
              marginBottom: 8,
              overflow: 'hidden',
            }}
          >
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
                <div style={{ fontSize: 15, fontWeight: 600, color: '#ffffff', marginBottom: isOpen ? 0 : 3 }}>
                  {item.title}
                </div>
                {!isOpen && (
                  <div style={{ fontSize: 13, color: '#7a7873' }}>{item.teaser}</div>
                )}
              </div>
              <span
                style={{
                  fontSize: 20,
                  color: '#7a7873',
                  flexShrink: 0,
                  lineHeight: 1,
                  transform: isOpen ? 'rotate(45deg)' : 'none',
                  transition: 'transform 0.2s',
                  display: 'inline-block',
                }}
              >
                +
              </span>
            </button>
            {isOpen && (
              <div style={{ padding: '0 20px 18px', fontSize: 14, color: '#e8e4dd', lineHeight: 1.65 }}>
                {item.content}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
