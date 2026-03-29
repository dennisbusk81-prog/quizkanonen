'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

type Code = {
  id: string
  code: string
  description: string
  valid_until: string | null
  max_uses: number
  used_count: number
  is_active: boolean
  created_at: string
}

export default function AdminCodes() {
  const router = useRouter()
  const [codes, setCodes] = useState<Code[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [form, setForm] = useState({ code: '', description: '', valid_days: '60', max_uses: '100' })

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }
    fetchCodes()
  }, [])

  function showFeedback(type: 'success' | 'error', msg: string) {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3000)
  }

  async function fetchCodes() {
    const { data, error } = await supabase
      .from('access_codes').select('*').order('created_at', { ascending: false })
    if (error) showFeedback('error', 'Kunne ikke hente koder: ' + error.message)
    setCodes(data || [])
    setLoading(false)
  }

  async function saveCode() {
    if (!form.code.trim() || !form.description.trim()) {
      showFeedback('error', 'Fyll inn kode og beskrivelse.')
      return
    }
    setSaving(true)
    const validUntil = form.valid_days
      ? new Date(Date.now() + parseInt(form.valid_days) * 24 * 60 * 60 * 1000).toISOString()
      : null

    const { error } = await supabase.from('access_codes').insert({
      code: form.code.trim().toUpperCase(),
      description: form.description.trim(),
      valid_until: validUntil,
      max_uses: parseInt(form.max_uses) || 100,
      used_count: 0,
      is_active: true,
    })

    if (error) {
      showFeedback('error', 'Feil ved lagring: ' + error.message)
    } else {
      showFeedback('success', 'Kode opprettet: ' + form.code.toUpperCase())
      setForm({ code: '', description: '', valid_days: '60', max_uses: '100' })
      setShowForm(false)
      fetchCodes()
    }
    setSaving(false)
  }

  async function toggleCode(id: string, current: boolean) {
    const { error } = await supabase
      .from('access_codes').update({ is_active: !current }).eq('id', id)
    if (error) showFeedback('error', 'Kunne ikke oppdatere: ' + error.message)
    else fetchCodes()
  }

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('no-NO') : 'Aldri'
  const isExpired = (d: string | null) => d ? new Date(d) < new Date() : false

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-white animate-pulse">Laster...</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/admin" className="text-gray-400 hover:text-white text-sm mb-2 inline-block">← Admin</Link>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black text-white">🎟️ Verdikoder</h1>
          <button onClick={() => setShowForm(!showForm)}
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black px-4 py-2 rounded-xl text-sm transition-all">
            {showForm ? '✕ Avbryt' : '+ Ny kode'}
          </button>
        </div>

        {feedback && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-semibold ${feedback.type === 'success' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
            {feedback.type === 'success' ? '✓ ' : '✕ '}{feedback.msg}
          </div>
        )}

        {showForm && (
          <div className="bg-gray-900 border border-yellow-400/30 rounded-2xl p-6 mb-6">
            <h2 className="text-white font-bold mb-4">Ny verdikode</h2>
            <div className="space-y-3">
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-1 block">Kode</label>
                <input type="text" value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="F.eks. BETATEST"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white font-mono placeholder-gray-500 focus:outline-none focus:border-yellow-400" />
              </div>
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-1 block">Beskrivelse</label>
                <input type="text" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="F.eks. Gratis tilgang til betatestere"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-300 text-sm font-semibold mb-1 block">Gyldig i dager</label>
                  <input type="number" value={form.valid_days}
                    onChange={e => setForm(f => ({ ...f, valid_days: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-400" />
                </div>
                <div>
                  <label className="text-gray-300 text-sm font-semibold mb-1 block">Maks antall brukere</label>
                  <input type="number" value={form.max_uses}
                    onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-400" />
                </div>
              </div>
              <button onClick={saveCode} disabled={saving}
                className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-950 font-black py-3 rounded-xl transition-all">
                {saving ? 'Lagrer...' : 'Lagre kode'}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {codes.length === 0 ? (
            <div className="bg-gray-900 rounded-2xl p-8 text-center border border-gray-800">
              <p className="text-gray-400">Ingen koder ennå. Lag din første!</p>
            </div>
          ) : codes.map(code => (
            <div key={code.id} className={`bg-gray-900 border rounded-2xl p-4 ${!code.is_active || isExpired(code.valid_until) ? 'border-gray-800 opacity-60' : 'border-gray-700'}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-yellow-400 font-mono font-black text-lg">{code.code}</span>
                    {!code.is_active && <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">Deaktivert</span>}
                    {isExpired(code.valid_until) && <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">Utløpt</span>}
                  </div>
                  <p className="text-gray-300 text-sm">{code.description}</p>
                  <p className="text-gray-500 text-xs mt-1">
                    Brukt: {code.used_count}/{code.max_uses} · Utløper: {formatDate(code.valid_until)}
                  </p>
                </div>
                <button onClick={() => toggleCode(code.id, code.is_active)}
                  className={`px-3 py-1.5 rounded-lg text-sm flex-shrink-0 transition-all ${code.is_active ? 'bg-orange-900 hover:bg-orange-800 text-orange-200' : 'bg-green-900 hover:bg-green-800 text-green-200'}`}>
                  {code.is_active ? 'Deaktiver' : 'Aktiver'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}