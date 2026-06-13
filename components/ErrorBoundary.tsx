'use client'

import { Component, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { crashed: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false }

  static getDerivedStateFromError(): State {
    return { crashed: true }
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error)
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
            fontFamily: "'Instrument Sans', sans-serif",
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
              fontFamily: "'Instrument Sans', sans-serif",
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
