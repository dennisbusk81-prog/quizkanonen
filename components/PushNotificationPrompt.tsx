'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buf
}

export default function PushNotificationPrompt() {
  const [visible, setVisible]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  // iOS Safari støtter web-push KUN når PWA-en er lagt til hjemskjermen.
  // I dette tilfellet viser vi installasjons-hint istedenfor en knapp som
  // ellers ville feilet stille.
  const [iosInstallHint, setIosInstallHint] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const ua = window.navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua)
    const isStandalone =
      ('standalone' in window.navigator && (window.navigator as Navigator & { standalone?: boolean }).standalone === true) ||
      window.matchMedia('(display-mode: standalone)').matches

    // iOS i Safari (ikke installert): push virker ikke — vis install-hint.
    if (isIOS && !isStandalone) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          setLoggedIn(true)
          setIosInstallHint(true)
          setVisible(true)
        }
      })
      return
    }

    if (!('PushManager' in window) || !('Notification' in window)) return
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setLoggedIn(true)
        setVisible(true)
      }
    })
  }, [])

  if (!visible) return null

  async function handleEnable() {
    setLoading(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setVisible(false); return }

      const reg = await navigator.serviceWorker.ready
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidKey) { setVisible(false); return }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setVisible(false); return }

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ subscription }),
      })
    } catch (err) {
      console.error('[PushPrompt]', err)
    } finally {
      setLoading(false)
      setVisible(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: '#21242e',
      borderTop: '1px solid #2a2d38',
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      zIndex: 9000,
      flexWrap: 'wrap',
      fontFamily: "'Instrument Sans', sans-serif",
    }}>
      <p style={{ fontSize: 14, color: '#e8e4dd', margin: 0, lineHeight: 1.4, flex: iosInstallHint ? '1 1 240px' : undefined }}>
        {iosInstallHint
          ? 'Legg til Quizkanonen på hjemskjermen først for å få varsler — trykk Del-knappen og velg «Legg til på Hjem-skjerm».'
          : 'Få varsel når ukens quiz er klar'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        {!iosInstallHint && (
          <button
            onClick={handleEnable}
            disabled={loading}
            style={{
              background: 'transparent',
              border: '1px solid #2a2d38',
              borderRadius: 10,
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: 600,
              color: '#e8e4dd',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontFamily: "'Instrument Sans', sans-serif",
              transition: 'border-color 0.15s',
            }}
          >
            {loading ? 'Aktiverer…' : 'Slå på varsler'}
          </button>
        )}
        <button
          onClick={() => setVisible(false)}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 13,
            color: '#7a7873',
            cursor: 'pointer',
            fontFamily: "'Instrument Sans', sans-serif",
            padding: 0,
          }}
        >
          {iosInstallHint ? 'Lukk' : 'Ikke nå'}
        </button>
      </div>
    </div>
  )
}
