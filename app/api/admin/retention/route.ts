import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin-auth'
import { fetchRetentionRows } from '@/lib/retention'

// Selve beregningen ligger i lib/retention.ts, delt med
// /api/admin/dashboard. Den delingen er poenget: retention-tabellen her og
// retention-kortet på dashboardet må aldri kunne vise ulike prosenter for
// samme quiz.
export type { RetentionRow } from '@/lib/retention'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await fetchRetentionRows()
    return NextResponse.json({ rows })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Kunne ikke hente retention' },
      { status: 500 },
    )
  }
}
