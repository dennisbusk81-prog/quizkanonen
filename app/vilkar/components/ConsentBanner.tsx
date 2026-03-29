'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function ConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem('qk_consent')
    if (!consent) setVisible(true)
  }, [])

  function accept() {
    localStorage.setItem('qk_consent', 'true')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4">
      <div className="max-w-2xl mx-auto bg-gray-900 border border-yellow-400/30 rounded-2xl p-5 shadow-2xl">
        <p className="text-white font-bold mb-1">🍪 Vi bruker lokal lagring</p>
        <p className="text-gray-400 text-sm mb-4">
          Quizkanonen lagrer en anonym enhets-ID lokalt i nettleseren din for å hindre dobbeltspilling og lagre fremgang. 
          Ingen data deles med tredjeparter. Les vår{' '}
          <Link href="/personvern" className="text-yellow-400 hover:underline">personvernerklæring</Link>.
        </p>
        <div className="flex gap-3">
          <button onClick={accept}
            className="flex-1 bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black py-2.5 rounded-xl text-sm transition-all">
            Jeg forstår og godtar
          </button>
          <Link href="/personvern"
            className="px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 rounded-xl text-sm transition-all text-center">
            Les mer
          </Link>
        </div>
      </div>
    </div>
  )
}