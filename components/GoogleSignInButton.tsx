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
      onClick={() => signInWithGoogle()}
    >
      {children}
    </button>
  )
}
