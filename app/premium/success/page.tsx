import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase-server'
import Link from 'next/link'

const s = {
  page: { minHeight: '100vh', background: '#1a1c23', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Instrument Sans', sans-serif" },
  card: { background: '#21242e', border: '1px solid #2a2d38', borderRadius: '16px', padding: '40px', maxWidth: '500px', width: '100%', textAlign: 'center' as const },
  icon: { width: 56, height: 56, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' },
  title: { fontFamily: "'Libre Baskerville', serif", fontSize: '1.75rem', color: '#ffffff', marginBottom: '8px' },
  subtitle: { color: '#e8e4dd', marginBottom: '32px', fontSize: '1rem', lineHeight: 1.6 },
  btn: { display: 'inline-block', padding: '11px 28px', background: '#c9a84c', color: '#1a1c23', border: 'none', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', textDecoration: 'none', fontFamily: "'Instrument Sans', sans-serif" },
}

export default async function PremiumSuccessPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('premium_status')
    .eq('id', user.id)
    .single()

  if (!profile?.premium_status) redirect('/premium')

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.icon}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l5 5L19 7" stroke="#c9a84c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={s.title}>Velkommen til Premium!</div>
        <div style={s.subtitle}>
          Betalingen gikk gjennom. Du har nå full tilgang til alle Premium-funksjoner på Quizkanonen.
        </div>
        <Link href="/" style={s.btn}>
          Gå til forsiden
        </Link>
      </div>
    </div>
  )
}
