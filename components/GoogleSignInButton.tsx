'use client'

import { signInWithGoogle } from '@/lib/auth'

interface Props {
  className?: string
  children: React.ReactNode
}

export default function GoogleSignInButton({ className, children }: Props) {
  return (
    <button
      type="button"
      className={className}
      style={{ width: '100%', cursor: 'pointer', background: 'transparent' }}
      onClick={() => {
        console.log('klikk registrert')
        signInWithGoogle()
      }}
    >
      {children}
    </button>
  )
}
