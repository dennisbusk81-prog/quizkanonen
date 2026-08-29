'use client'

import { Component, ReactNode } from 'react'
import { logClientError } from '@/lib/client-error'

interface Props { children: ReactNode }
interface State { crashed: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false }

  static getDerivedStateFromError(): State {
    return { crashed: true }
  }

  // En error boundary STOPPER feilen fra å nå window.onerror, så
  // GlobalHandlers-integrasjonen ser den aldri. Uten linja under er en full
  // render-krasj i denne komponenten usynlig for Dennis — og den er montert 12
  // steder: forsiden ×5, quiz-siden, /historikk, /arkiv, /toppliste.
  componentDidCatch(error: Error) {
    logClientError('error-boundary', error)
  }

  render() {
    if (this.state.crashed) {
      return (
        <div style={{
          background: '#21242e',
          border: '1px solid #2a2d38',
          borderRadius: 16,
          padding: '24px 20px',
          textAlign: 'center',
        }}>
          <p style={{
            fontSize: 14,
            color: '#e8e4dd',
            lineHeight: 1.6,
            marginBottom: 16,
            fontFamily: "var(--font-instrument-sans), sans-serif",
          }}>
            Noe gikk galt her. Prøv å laste siden på nytt.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'transparent',
              border: '1px solid #2a2d38',
              borderRadius: 10,
              padding: '10px 28px',
              fontSize: 14,
              fontWeight: 600,
              color: '#e8e4dd',
              cursor: 'pointer',
              fontFamily: "var(--font-instrument-sans), sans-serif",
            }}
          >
            Last inn på nytt
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
