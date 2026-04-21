import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ played: false })

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return NextResponse.json({ played: false })

  const { id: quizId } = await params

  const { data } = await supabaseAdmin
    .from('attempts')
    .select('id')
    .eq('quiz_id', quizId)
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ played: !!data })
}
