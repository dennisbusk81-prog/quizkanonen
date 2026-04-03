'use client'

interface Props {
  className?: string
  children: React.ReactNode
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!

export default function GoogleSignInButton({ className, children }: Props) {
  function handleClick() {
    const redirectTo = encodeURIComponent(`${window.location.origin}/auth/callback`)
    window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}`
  }

  return (
    <button type="button" className={className} onClick={handleClick}>
      {children}
    </button>
  )
}
