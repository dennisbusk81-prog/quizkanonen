'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function NextQuizSetting() {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    async function fetch() {
      const { data, error } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'next_quiz_at')
        .single()
      if (error && error.code !== 'PGRST116') console.error('NextQuizSetting fetch feilet:', error)
      if (data?.value) {
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
    const isoValue = new Date(value).toISOString()
    const { error } = await supabase
      .from('site_settings')
      .upsert({ key: 'next_quiz_at', value: isoValue, updated_at: new Date().toISOString() })
    if (error) {
      setFeedback({ type: 'error', msg: 'Kunne ikke lagre: ' + error.message })
    } else {
      setFeedback({ type: 'success', msg: 'Neste quiz-dato lagret!' })
    }
    setSaving(false)
    setTimeout(() => setFeedback(null), 3000)
  }

  return (
    <div style={{
      background: '#21242e',
      border: '1px solid #2a2d38',
      borderRadius: 20,
      padding: '20px 24px',
      marginBottom: 24,
    }}>
      <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>⏱️ Neste quiz</h2>
      <p style={{ color: '#6a6860', fontSize: 12, marginBottom: 16 }}>Vises som nedtelling på forsiden.</p>

      {feedback && (
        <div style={{
          marginBottom: 12,
          padding: '8px 14px',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          background: feedback.type === 'success' ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
          border: `1px solid ${feedback.type === 'success' ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
          color: feedback.type === 'success' ? '#4ade80' : '#f87171',
        }}>
          {feedback.msg}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a6860', display: 'block', marginBottom: 8 }}>
            Dato og klokkeslett
          </label>
          <input
            type="datetime-local"
            value={value}
            onChange={e => setValue(e.target.value)}
            style={{
              width: '100%',
              background: '#1a1c23',
              border: '1px solid #2a2d38',
              borderRadius: 10,
              padding: '10px 14px',
              color: '#fff',
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
              colorScheme: 'dark',
            }}
          />
        </div>
        <button
          onClick={save}
          disabled={saving || !value}
          style={{
            alignSelf: 'flex-start',
            background: '#c9a84c',
            color: '#0f0f10',
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 700,
            padding: '10px 20px',
            borderRadius: 10,
            border: 'none',
            cursor: saving || !value ? 'not-allowed' : 'pointer',
            opacity: saving || !value ? 0.4 : 1,
            transition: 'background 0.15s',
          }}
        >
          {saving ? 'Lagrer...' : 'Lagre'}
        </button>
      </div>
    </div>
  )
}
