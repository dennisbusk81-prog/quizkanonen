'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function NewQuiz() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Allmennkunnskap',
    opens_at: '',
    closes_at: '',
    time_limit_seconds: 30,
    num_options: 4,
    show_leaderboard: true,
    hide_leaderboard_until_closed: true,
    show_live_placement: false,
    show_answer_explanation: true,
    randomize_questions: false,
    allow_teams: true,
    requires_access_code: false,
    is_active: true,
  })

  useEffect(() => {
    if (!isAdminLoggedIn()) { router.push('/admin/login'); return }

    // Sett default åpningstid til neste fredag kl 17:00
    const now = new Date()
    const dayOfWeek = now.getDay()
    const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 6
    const nextFriday = new Date(now)
    nextFriday.setDate(now.getDate() + (daysUntilFriday === 0 ? 7 : daysUntilFriday))
    nextFriday.setHours(17, 0, 0, 0)
    const nextFridayClose = new Date(nextFriday)
    nextFridayClose.setDate(nextFriday.getDate() + 7)

    const toLocal = (d: Date) => {
      const pad = (n: number) => n.toString().padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    setForm(f => ({ ...f, opens_at: toLocal(nextFriday), closes_at: toLocal(nextFridayClose) }))
  }, [])

  const update = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }))

  const handleSave = async () => {
    if (!form.title || !form.opens_at || !form.closes_at) {
      alert('Fyll inn tittel, åpningstid og stengetid.')
      return
    }
    setSaving(true)
    const { data, error } = await supabase.from('quizzes').insert({
      ...form,
      opens_at: new Date(form.opens_at).toISOString(),
      closes_at: new Date(form.closes_at).toISOString(),
    }).select().single()

    if (error) {
      alert('Feil ved lagring: ' + error.message)
      setSaving(false)
      return
    }
    router.push(`/admin/quizzes/${data.id}/questions`)
  }

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <Link href="/admin/quizzes" className="text-gray-400 hover:text-white text-sm mb-4 inline-block">← Tilbake</Link>
        <h1 className="text-2xl font-black text-white mb-8">➕ Lag ny quiz</h1>

        <div className="space-y-6">

          {/* Grunninfo */}
          <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h2 className="text-white font-bold mb-4">📝 Grunnleggende info</h2>
            <div className="space-y-4">
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">Tittel *</label>
                <input type="text" value={form.title} onChange={e => update('title', e.target.value)}
                  placeholder="F.eks. Fredagsquiz #12"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400" />
              </div>
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">Beskrivelse</label>
                <textarea value={form.description} onChange={e => update('description', e.target.value)}
                  placeholder="Kort beskrivelse av quizen..."
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 resize-none" />
              </div>
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">Kategori</label>
                <select value={form.category} onChange={e => update('category', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-400">
                  {['Allmennkunnskap', 'Sport', 'Historie', 'Geografi', 'Musikk', 'Film og TV', 'Vitenskap', 'Norsk'].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Tid */}
          <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h2 className="text-white font-bold mb-4">⏰ Åpnings- og stengetid</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">Åpner *</label>
                <input type="datetime-local" value={form.opens_at} onChange={e => update('opens_at', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-400" />
              </div>
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">Stenger *</label>
                <input type="datetime-local" value={form.closes_at} onChange={e => update('closes_at', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-yellow-400" />
              </div>
            </div>
            <p className="text-gray-500 text-xs mt-2">Standard: åpner neste fredag kl 17:00, stenger uken etter.</p>
          </section>

          {/* Spillinnstillinger */}
          <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h2 className="text-white font-bold mb-4">🎮 Spillinnstillinger</h2>
            <div className="space-y-4">
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">
                  Tidsbegrensning per spørsmål: {form.time_limit_seconds} sekunder
                </label>
                <input type="range" min={10} max={120} step={5} value={form.time_limit_seconds}
                  onChange={e => update('time_limit_seconds', parseInt(e.target.value))}
                  className="w-full accent-yellow-400" />
                <div className="flex justify-between text-gray-500 text-xs mt-1">
                  <span>10s</span><span>30s</span><span>60s</span><span>120s</span>
                </div>
              </div>
              <div>
                <label className="text-gray-300 text-sm font-semibold mb-2 block">Antall svaralternativer</label>
                <div className="flex gap-3">
                  {[2, 3, 4].map(n => (
                    <button key={n} onClick={() => update('num_options', n)}
                      className={`flex-1 py-2 rounded-xl font-bold transition-all ${form.num_options === n ? 'bg-yellow-400 text-gray-950' : 'bg-gray-800 text-white'}`}>
                      {n} alternativer
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Av/på-innstillinger */}
          <section className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h2 className="text-white font-bold mb-4">🔧 Funksjoner</h2>
            <div className="space-y-3">
              {[
                { key: 'show_leaderboard', label: 'Vis leaderboard', desc: 'Spillere kan se rangeringen' },
                { key: 'hide_leaderboard_until_closed', label: 'Skjul leaderboard til quiz stenger', desc: 'Hindrer at folk ser andres score under spilling' },
                { key: 'show_live_placement', label: 'Vis live plassering', desc: 'Spilleren ser sin egen plassering underveis' },
                { key: 'show_answer_explanation', label: 'Vis forklaring etter svar', desc: 'Viser en kort forklaring etter hvert svar' },
                { key: 'randomize_questions', label: 'Tilfeldig rekkefølge', desc: 'Spørsmålene vises i tilfeldig rekkefølge' },
                { key: 'allow_teams', label: 'Tillat lag-modus', desc: 'Spillere kan velge å spille som lag' },
                { key: 'requires_access_code', label: 'Krever verdikode', desc: 'Kun spillere med kode kan delta' },
                { key: 'is_active', label: 'Publisert', desc: 'Quizen vises på forsiden' },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                  <div>
                    <p className="text-white text-sm font-semibold">{item.label}</p>
                    <p className="text-gray-500 text-xs">{item.desc}</p>
                  </div>
                  <button
                    onClick={() => update(item.key, !(form as any)[item.key])}
                    className={`w-12 h-6 rounded-full transition-all flex-shrink-0 ml-4 ${(form as any)[item.key] ? 'bg-yellow-400' : 'bg-gray-700'}`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-all transform ${(form as any)[item.key] ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Lagre */}
          <button onClick={handleSave} disabled={saving}
            className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-950 font-black text-xl py-4 rounded-2xl transition-all">
            {saving ? 'Lagrer...' : 'Lagre og legg til spørsmål →'}
          </button>
        </div>
      </div>
    </main>
  )
}