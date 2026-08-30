'use client'
import { Component, ReactNode } from 'react'
import { logClientError } from '@/lib/client-error'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

// Omdøpt fra UserMenuErrorBoundary i B-30/A2 steg 2: den wrapper nå
// <GlobalNav /> — hele toppnavigasjonen — i app/layout.tsx. En ufanget krasj
// i en layout-montert klientkomponent ville ellers blanket HELE appen.
export default class NavErrorBoundary extends Component<Props, State> {
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

  render() {
    if (this.state.hasError) return this.props.fallback ?? null
    return this.props.children
  }
}
