'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isAdminLoggedIn, logoutAdmin } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function AdminHome() {
  const router = useRouter()
  const [stats, setStats] = useState({ quizzes: 0, attempts: 0, codes: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdminLoggedIn()) {
      router.push('/admin/login')
      return
    }
    fetchStats()
  }, [])

  async function fetchStats() {
    const [{ count: quizzes }, { count: attempts }, { count: codes }] = await Promise.all([
      supabase.from('quizzes').select('*', { count: 'exact', head: true }),
      supabase.from('attempts').select('*', { count: 'exact', head: true }),
      supabase.from('access_codes').select('*', { count: 'exact', head: true }),
    ])
    setStats({ quizzes: quizzes || 0, attempts: attempts || 0, codes: codes || 0 })
    setLoading(false)
  }

  const handleLogout = () => {
    logoutAdmin()
    router.push('/admin/login')
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-white animate-pulse">Laster...</p>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-950 px-4 py-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-black text-white">💥 Admin-panel</h1>
            <p className="text-gray-400 text-sm mt-1">Quizkanonen</p>
          </div>
          <div className="flex gap-3">
            <Link href="/" target="_blank"
              className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-xl text-sm transition-all">
              Se siden →
            </Link>
            <button onClick={handleLogout}
              className="bg-red-900 hover:bg-red-800 text-red-200 px-4 py-2 rounded-xl text-sm transition-all">
              Logg ut
            </button>
          </div>
        </div>

        {/* Statistikk */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Quizer', value: stats.quizzes, icon: '🎯' },
            { label: 'Gjennomspillinger', value: stats.attempts, icon: '🎮' },
            { label: 'Verdikoder', value: stats.codes, icon: '🎟️' },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
              <p className="text-3xl mb-1">{s.icon}</p>
              <p className="text-3xl font-black text-white">{s.value}</p>
              <p className="text-gray-400 text-sm">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Snarveier */}
        <div className="grid grid-cols-1 gap-4">
          {[
            { href: '/admin/quizzes', icon: '📋', title: 'Administrer quizer', desc: 'Se, lag, rediger og publiser quizer' },
            { href: '/admin/quizzes/new', icon: '➕', title: 'Lag ny quiz', desc: 'Opprett en ny fredagsquiz' },
            { href: '/admin/codes', icon: '🎟️', title: 'Verdikoder', desc: 'Lag og administrer tilgangskoder' },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-2xl p-5 flex items-center gap-4 transition-all group">
              <span className="text-3xl">{item.icon}</span>
              <div>
                <p className="text-white font-bold group-hover:text-yellow-400 transition-colors">{item.title}</p>
                <p className="text-gray-400 text-sm">{item.desc}</p>
              </div>
              <span className="ml-auto text-gray-600 group-hover:text-gray-400">→</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}