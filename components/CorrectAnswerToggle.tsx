'use client'

// Delt velger for riktig(e) svar. Brukes fire steder:
//   - /admin/quizzes/[id]/questions      — skjemaet (ny + rediger)
//   - /admin/quizzes/[id]/questions      — «Rett svar»-panelet
//   - /admin/quizzes/new                 — spørsmålskortet
//   - /admin/quizzes/new                 — «Rett svar»-panelet
//
// Fram til nå kunne bare «Spørsmål»-siden sette flere riktige svar, og den
// hadde sin egen toggle-implementasjon mens «Rediger»-siden hadde et enkeltvalg
// som ikke engang leste correct_answers. Én komponent i stedet for tre kopier.
//
// Invariant: minst ett svar må alltid være valgt. Et klikk som ville tømt
// utvalget ignoreres — da er «fjern det andre svaret» eneste vei tilbake til
// ett riktig svar, aldri null.

type Props = {
  /** Tilgjengelige alternativer, allerede kuttet til quizens num_options. */
  options: string[]
  /** Valgte svar. Rekkefølgen betyr noe: første element blir correct_answer. */
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /** 'sm' brukes i det kompakte «Rett svar»-panelet. */
  size?: 'sm' | 'md'
}

export function toggleAnswerKey(current: string[], option: string): string[] {
  const next = current.includes(option)
    ? current.filter(o => o !== option)
    : [...current, option]
  return next.length === 0 ? current : next
}

export default function CorrectAnswerToggle({
  options,
  value,
  onChange,
  disabled = false,
  size = 'md',
}: Props) {
  const pad = size === 'sm' ? '7px 4px' : '9px 6px'
  const fontSize = size === 'sm' ? 13 : 14

  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        {options.map(opt => {
          const active = value.includes(opt)
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(toggleAnswerKey(value, opt))}
              style={{
                flex: 1,
                padding: pad,
                borderRadius: 8,
                border: `1px solid ${active ? 'rgba(74,222,128,0.3)' : '#2a2d38'}`,
                background: active ? 'rgba(74,222,128,0.1)' : '#1a1c23',
                color: active ? '#4ade80' : '#918f8a',
                fontFamily: "'Instrument Sans', sans-serif",
                fontSize,
                fontWeight: 600,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                transition: 'all 0.15s',
              }}
            >
              {opt}
            </button>
          )
        })}
      </div>
      {value.length > 1 && (
        <p style={{
          fontSize: 11,
          color: '#918f8a',
          marginTop: 6,
          fontFamily: "'Instrument Sans', sans-serif",
        }}>
          Valgt: {value.join(', ')} — {value.length} riktige svar
        </p>
      )}
    </div>
  )
}
