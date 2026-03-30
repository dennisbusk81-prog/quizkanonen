'use client'
import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;1,400&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body { background: #1a1c23; }

  .cb-screen {
    min-height: 100vh;
    background: #1a1c23;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cb-screen p {
    font-family: 'Libre Baskerville', serif;
    font-size: 18px;
    color: #6a6860;
    font-style: italic;
  }
`

function CallbackHandler() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const code = searchParams.get('code')
    const next = searchParams.get('next') ?? '/'

    async function handle() {
      if (!code) {
        router.replace(next)
        return
      }

      const { data, error } = await supabase.auth.exchangeCodeForSession(code)

      if (error || !data.session) {
        router.replace('/login?error=auth_failed')
        return
      }

      router.replace(next)
    }

    handle()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <style>{STYLES}</style>
      <div className="cb-screen">
        <p>Logger inn...</p>
      </div>
    </>
  )
}

export default function AuthCallback() {
  return (
    <Suspense
      fallback={
        <>
          <style>{STYLES}</style>
          <div className="cb-screen"><p>Laster...</p></div>
        </>
      }
    >
      <CallbackHandler />
    </Suspense>
  )
}
