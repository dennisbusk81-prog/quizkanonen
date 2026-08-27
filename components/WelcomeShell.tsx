import type { CSSProperties, ReactNode } from 'react'
import {
  welcomeBodyText,
  welcomeColumn,
  welcomeEyebrow,
  welcomeScreen,
  welcomeTitle,
} from '@/lib/welcome-styles'

// Den felles rammen rundt en velkomstskjerm: sidebakgrunn, kolonnebredde
// og toppseksjonen (eyebrow → tittel → ingress).
//
// Rent presentasjonelt med vilje. Ingen state, ingen henting, ingen betingelser
// — begge sidene som bruker den eier sin egen tilstandsmodell, og de er ulike
// (se lib/welcome-styles.ts for hvorfor). Det eneste denne komponenten lover er
// at de SER like ut.
//
// Ingen 'use client': uten hooks kan den brukes fra både server- og
// klientkomponenter.

type Props = {
  /** Ekstra CSS for denne skjermen. F.eks. en box-sizing-reset. */
  styleExtra?: string
  /** Rendres mellom <style> og sideinnholdet — typisk en brukermeny. */
  nav?: ReactNode
  eyebrow: string
  title: ReactNode
  /** Ingressen under tittelen. Utelatt → ingen <p>. */
  lead?: ReactNode
  children: ReactNode
}

const leadStyle: CSSProperties = { ...welcomeBodyText, marginBottom: 32 }

export default function WelcomeShell({ styleExtra, nav, eyebrow, title, lead, children }: Props) {
  return (
    <>
      <style>{styleExtra ?? ''}</style>
      {nav}

      <div style={welcomeScreen}>
        <div style={welcomeColumn}>
          <p style={welcomeEyebrow}>{eyebrow}</p>
          <h1 style={welcomeTitle}>{title}</h1>
          {lead && <p style={leadStyle}>{lead}</p>}

          {children}
        </div>
      </div>
    </>
  )
}
