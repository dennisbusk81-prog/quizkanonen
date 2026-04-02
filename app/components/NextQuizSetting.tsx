'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function NextQuizSetting() {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'next_quiz_at')
        .single()
      if (data?.value) {
        // Konverter til norsk format for datetime-local input
        const d = new Date(data.value)
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
        setValue(local)
      }
    }
    fetch()
  }, [])

  async function save() {
    if (!value) return
    setSaving(true)
    try {
      const isoValue = new Date(value).toISOString()
      const { error } = await supabase
        .from('site_settings')
        .upsert({ key: 'next_quiz_at', value: isoValue, updated_at: new Date().toISOString() })
      if (error) {
        setFeedback({ type: 'error', msg: 'Kunne ikke lagre: ' + error.message })
      } else {
        setFeedback({ type: 'success', msg: 'Neste quiz-dato lagret!' })
      }
    } catch {
      setFeedback({ type: 'error', msg: 'Uventet feil ved lagring.' })
    } finally {
      setSaving(false)
      setTimeout(() => setFeedback(null), 3000)
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
      <h2 className="text-white font-bold mb-1">⏱️ Neste quiz</h2>
      <p className="text-gray-500 text-sm mb-4">Vises som nedtelling på forsiden.</p>

      {feedback && (
        <div className={`mb-3 px-4 py-2 rounded-xl text-sm font-semibold ${feedback.type === 'success' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}`}>
          {feedback.msg}
        </div>
      )}

      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="text-gray-400 text-xs font-semibold mb-1 block">Dato og klokkeslett</label>
          <input
            type="datetime-local"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-yellow-400 text-sm"
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-950 font-black px-5 py-2.5 rounded-xl text-sm transition-all"
        >
          {saving ? 'Lagrer...' : 'Lagre'}
        </button>
      </div>
    </div>
  )
}