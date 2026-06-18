import type React from 'react'

/**
 * Visningsregel for spillernavn (gjelder leaderboards og topplister):
 *  - Har bruker kallenavn: vis kallenavn i full størrelse, ekte navn diskret under.
 *  - Har ikke kallenavn: vis bare ekte navn — ingen tom plass, ingen layout-endring.
 *
 * primaryStyle settes av kallestedet så fontstørrelse/farge matcher konteksten.
 * Sekundærlinjen er alltid 12px #7a7873 per designsystemet.
 */
export default function PlayerName({
  nickname,
  displayName,
  primaryStyle,
  secondaryStyle,
}: {
  nickname?: string | null
  displayName: string | null | undefined
  primaryStyle?: React.CSSProperties
  secondaryStyle?: React.CSSProperties
}) {
  const nick = nickname?.trim()
  const name = displayName ?? ''
  const hasNick = !!nick && nick.length > 0

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.2 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...primaryStyle }}>
        {hasNick ? nick : name}
      </span>
      {hasNick && (
        <span
          style={{
            fontSize: 12,
            color: '#7a7873',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...secondaryStyle,
          }}
        >
          {name}
        </span>
      )}
    </span>
  )
}
