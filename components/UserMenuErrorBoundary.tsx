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

export default class UserMenuErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  // Denne står i app/layout.tsx og wrapper UserMenu på HVER side. Den rendrer
  // dessuten `fallback ?? null` ved krasj — altså ingenting. Uten linja under
  // forsvinner brukermenyen sporløst for brukeren OG for oss.
  componentDidCatch(error: Error) {
    logClientError('user-menu-boundary', error)
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null
    return this.props.children
  }
}
