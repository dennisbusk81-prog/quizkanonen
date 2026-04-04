'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Instrument+Sans:wght@400;500;600&display=swap');`

type League = {
  id: string
  name: string
  slug: string
  is_owner: boolean
  member_count: number
  invite_token: string
  reset_at: string | null
  created_at: string
}

const s = {
  wrap:     { minHeight: '100vh', background: '#1a1c23', fontFamily: "'Instrument Sans', sans-serif", color: '#e8e4dd' },
  page:     { maxWidth: 640, margin: '0 auto', padding: '0 20px 60px' },
  centered: { minHeight: '100vh', background: '#1a1c23', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  spinner:  { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#7a7873', fontStyle: 'italic' as const },
  back:     { display: 'inline-block', fontSize: 12, color: '#7a7873', textDecoration: 'none', marginBottom: 14, letterSpacing: '0.04em' },

  hero:        { paddingTop: 24, paddingBottom: 20 },
  heroEyebrow: { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#7a7873', marginBottom: 6 },
  heroTitle:   { fontFamily: "'Libre Baskerville', serif", fontSize: 28, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.01em' },
  heroTitleEm: { fontStyle: 'italic', color: '#c9a84c' },
  rule:        { width: '100%', height: 1, background: '#2a2d38', marginBottom: 20 },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' },
  sectionText:   { fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#7a7873', whiteSpace: 'nowrap' as const },
  sectionLine:   { flex: 1, height: 1, background: '#2a2d38' },
  sectionCount:  { fontSize: 11, fontWeight: 600, color: '#7a7873', background: '#21242e', border: '1px solid #2a2d38', padding: '2px 8px', borderRadius: 20 },

  rowBase:   { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, textDecoration: 'none', cursor: 'pointer' as const, transition: 'border-color 0.12s' },
  rowHover:  { background: '#252836', border: '1px solid rgba(201,168,76,0.28)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, textDecoration: 'none', cursor: 'pointer' as const },
  rowName:   { fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#ffffff', marginBottom: 3 },
  rowMeta:   { fontSize: 12, color: '#7a7873' },
  rowRight:  { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  ownerBadge:{ fontSize: 10, fontWeight: 600, color: '#c9a84c', background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 4, padding: '2px 7px' },
  rowArrow:  { fontSize: 14, color: '#7a7873' },

  createCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '20px 20px', marginBottom: 16 },
  createLabel: { fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#7a7873', marginBottom: 10 },
  inputRow:    { display: 'flex', gap: 8 },
  input:       { flex: 1, background: '#1a1c23', border: '1px solid #2a2d38', borderRadius: 10, padding: '10px 14px', fontSize: 15, color: '#ffffff', fontFamily: "'Instrument Sans', sans-serif", outline: 'none' },
  btnGold:     { padding: '10px 20px', background: '#c9a84c', color: '#0f0f10', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer' },
  btnGoldDis:  { padding: '10px 20px', background: '#3a3d4a', color: '#7a7873', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'not-allowed' },
  cancelBtn:   { marginTop: 10, background: 'none', border: 'none', fontSize: 12, color: '#7a7873', cursor: 'pointer', padding: 0, fontFamily: "'Instrument Sans', sans-serif" },
  createErrMsg:{ fontSize: 12, color: '#f87171', marginTop: 8 },

  openCreateBtn: { padding: '10px 28px', background: '#c9a84c', color: '#0f0f10', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: "'Instrument Sans', sans-serif", cursor: 'pointer', marginBottom: 20 },

  empty:      { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 20, padding: '40px 24px', textAlign: 'center' as const, marginTop: 4 },
  emptyTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 18, color: '#ffffff', marginBottom: 8 },
  emptySub:   { fontSize: 13, color: '#7a7873', lineHeight: 1.6 },

  ctaCard:  { background: '#21242e', border: '1px solid #2a2d38', borderRadius: 16, padding: '24px 20px', textAlign: 'center' as const, marginTop: 24 },
  ctaTitle: { fontFamily: "'Libre Baskerville', serif", fontSize: 16, fontWeight: 700, color: '#ffffff', marginBottom: 6 },
  ctaSub:   { fontSize: 13, color: '#7a7873', marginBottom: 16, lineHeight: 1.5 },
  ctaLink:  { display: 'inline-block', background: '#c9a84c', color: '#0f0f10', fontFamily: "'Instrument Sans', sans-serif", fontSize: 14, fontWeight: 700, padding: '10px 22px', borderRadius: 10, textDecoration: 'none' },
} as const

type LoadState = 'loading' | 'ready' | 'error'

export default function MineLigaerPage() {
  const router = useRouter()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [leagues, setLeagues] = useState<League[]>([])
  const [isPremium, setIsPremium] = useState(false)
  const [accessToken, setAccessToken] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      let { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        await new Promise<void>(r => setTimeout(r, 500))
        if (cancelled) return
        const { data } = await supabase.auth.getSession()
        session = data.session
      }
      if (cancelled) return
      if (!session) { router.replace('/'); return }

      setAccessToken(session.access_token)

      const [profileRes, leaguesRes] = await Promise.all([
        supabase.from('profiles').select('premium_status').eq('id', session.user.id).maybeSingle(),
        fetch('/api/leagues', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ])

      if (cancelled) return

      setIsPremium(profileRes.data?.premium_status === true)

      if (!leaguesRes.ok) { setLoadState('error'); return }
      const json = await leaguesRes.json()
      setLeagues(json.leagues ?? [])
      if (!cancelled) setLoadState('ready')
    }

    load().catch(() => { if (!cancelled) setLoadState('error') })
    return () => { cancelled = true }
  }, [router])

  async function handleCreate() {
    if (!newName.trim() || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error ?? 'Noe gikk galt. Prøv igjen.')
      } else {
        router.push(`/liga/${data.league.slug}`)
      }
    } catch {
      setCreateError('Noe gikk galt. Prøv igjen.')
    } finally {
      setCreating(false)
    }
  }

  if (loadState === 'loading') return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.centered}><p style={s.spinner}>Laster ligaer…</p></div>
    </>
  )

  if (loadState === 'error') return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.centered}><p style={s.spinner}>Noe gikk galt. Prøv igjen.</p></div>
    </>
  )

  return (
    <>
      <style>{FONT_IMPORT}</style>
      <div style={s.wrap}>
        <div style={s.page}>
          <div style={{ paddingTop: 20 }}>
            <Link href="/" style={s.back}>← Tilbake til forsiden</Link>
          </div>

          <div style={s.hero}>
            <p style={s.heroEyebrow}>Quizkanonen</p>
            <h1 style={s.heroTitle}>
              Mine <em style={s.heroTitleEm}>ligaer</em>
            </h1>
          </div>

          <div style={s.rule} />

          {/* Create flow (Premium only) */}
          {isPremium && (
            showCreate ? (
              <div style={s.createCard}>
                <p style={s.createLabel}>Ny liga</p>
                <div style={s.inputRow}>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => { setNewName(e.target.value); setCreateError(null) }}
                    onKeyDown={e => { if (e.key === 'Enter' && newName.trim() && !creating) handleCreate() }}
                    placeholder="Gi ligaen et navn…"
                    maxLength={60}
                    autoFocus
                    style={s.input}
                    onFocus={e => { e.currentTarget.style.borderColor = '#c9a84c' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#2a2d38' }}
                  />
                  <button
                    onClick={handleCreate}
                    disabled={creating || !newName.trim()}
                    style={creating || !newName.trim() ? s.btnGoldDis : s.btnGold}
                  >
                    {creating ? 'Oppretter…' : 'Opprett'}
                  </button>
                </div>
                {createError && <p style={s.createErrMsg}>{createError}</p>}
                <button
                  onClick={() => { setShowCreate(false); setNewName(''); setCreateError(null) }}
                  style={s.cancelBtn}
                >
                  Avbryt
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                style={s.openCreateBtn}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
              >
                + Opprett ny liga
              </button>
            )
          )}

          {/* League list */}
          {leagues.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyTitle}>Du er ikke med i noen ligaer ennå</div>
              <p style={s.emptySub}>
                Bruk en invitasjonslenke fra en venn for å bli med, eller oppgrader til Premium for å opprette din egen liga.
              </p>
            </div>
          ) : (
            <>
              <div style={s.sectionHeader}>
                <span style={s.sectionText}>Ligaer</span>
                <div style={s.sectionLine} />
                <span style={s.sectionCount}>{leagues.length}</span>
              </div>
              {leagues.map(league => (
                <Link
                  key={league.id}
                  href={`/liga/${league.slug}`}
                  style={hoveredId === league.id ? s.rowHover : s.rowBase}
                  onMouseEnter={() => setHoveredId(league.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div>
                    <div style={s.rowName}>{league.name}</div>
                    <div style={s.rowMeta}>
                      {league.member_count} {league.member_count === 1 ? 'medlem' : 'medlemmer'}
                    </div>
                  </div>
                  <div style={s.rowRight}>
                    {league.is_owner && <span style={s.ownerBadge}>Eier</span>}
                    <span style={s.rowArrow}>→</span>
                  </div>
                </Link>
              ))}
            </>
          )}

          {/* Non-premium CTA */}
          {!isPremium && (
            <div style={s.ctaCard}>
              <div style={s.ctaTitle}>Opprett din egen liga</div>
              <p style={s.ctaSub}>
                Med Premium kan du opprette en liga, invitere venner og følge med på hvem som er best.
              </p>
              <Link href="/premium" style={s.ctaLink}>Oppgrader til Premium</Link>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
