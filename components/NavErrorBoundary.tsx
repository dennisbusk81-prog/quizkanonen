'use client'
import { Component, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { logClientError } from '@/lib/client-error'
import { shouldResetNavBoundary } from '@/lib/nav-boundary-reset'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface InnerProps extends Props {
  pathname: string | null
}

interface State {
  hasError: boolean
}

// Omdøpt fra UserMenuErrorBoundary i B-30/A2 steg 2: den wrapper nå
// <GlobalNav /> — hele toppnavigasjonen — i app/layout.tsx. En ufanget krasj
// i en layout-montert klientkomponent ville ellers blanket HELE appen.
//
// RESETTEN (31. august 2026): rot-layouten remontes ikke ved klientnavigasjon,
// så uten reset var én render-krasj her permanent — fallback er null, og appen
// ble navløs for resten av økten. Nå nullstilles hasError når pathname endres:
// brukerens neste navigasjon gir nav-en et nytt forsøk.
//
// Hvorfor denne formen og ikke key={pathname} på boundaryen: en key remonterer
// GlobalNav-treet på HVER navigasjon også når alt er friskt — intern state
// ryker og alle effekter kjøres på nytt, en fast kostnad på hver navigasjon
// for et unntakstilfelle. Resetten her rører kun krasj-tilstanden; den friske
// stien er identisk med før. (Begge formene trenger uansett funksjonswrapperen
// under — rot-layouten er en serverkomponent og klasser kan ikke bruke hooks.)
//
// Løkke-vakten bor i shouldResetNavBoundary (lib/nav-boundary-reset.ts, der
// den er testdekket): reset KUN når pathname faktisk endret seg, aldri på
// re-renders av samme rute. En konsekvent krasjende nav krasjer dermed maks
// én gang per navigasjon — ikke i løkke.

class NavErrorBoundaryInner extends Component<InnerProps, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  // Denne står i app/layout.tsx og wrapper GlobalNav på HVER side. Den rendrer
  // dessuten `fallback ?? null` ved krasj — altså ingenting. Uten linja under
  // forsvinner navigasjonen sporløst for brukeren OG for oss.
  componentDidCatch(error: Error) {
    logClientError('global-nav-boundary', error)
  }

  componentDidUpdate(prevProps: InnerProps) {
    if (shouldResetNavBoundary(this.state.hasError, prevProps.pathname, this.props.pathname)) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null
    return this.props.children
  }
}

// usePathname abonnerer på router-contexten, så wrapperen re-rendres ved hver
// klientnavigasjon — også mens klassen står i krasj-tilstand og rendrer null.
// Det er dét som gjør at klassen i det hele tatt får se den nye
// pathname-verdien i props.
export default function NavErrorBoundary(props: Props) {
  const pathname = usePathname()
  return <NavErrorBoundaryInner {...props} pathname={pathname} />
}
