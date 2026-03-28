'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkAdminPassword, setAdminSession } from '@/lib/admin-auth'

export default function AdminLogin() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    await new Promise(r => setTimeout(r, 500)) // Liten forsinkelse for sikkerhet
    if (checkAdminPassword(password)) {
      setAdminSession()
      router.push('/admin')
    } else {
      setError('Feil passord. Prøv igjen.')
    }
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-sm border border-gray-800">
        <h1 className="text-2xl font-black text-white mb-2 text-center">💥 Quizkanonen</h1>
        <p className="text-gray-400 text-center mb-8 text-sm">Admin-tilgang</p>

        <div className="space-y-4">
          <div>
            <label className="text-gray-300 text-sm font-semibold mb-2 block">Passord</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Skriv inn adminpassord..."
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            onClick={handleLogin}
            disabled={loading || !password}
            className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 text-gray-950 font-black py-3 rounded-xl transition-all"
          >
            {loading ? 'Logger inn...' : 'Logg inn'}
          </button>
        </div>
      </div>
    </main>
  )
}