import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const runId = crypto.randomUUID()
  const context = 'cron/auto-complete-appointments'
  const istToday = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')
  const runMeta = { runId, beforeDate: istToday }
  logger.info(context, 'Run started', { ...runMeta, phase: 'start' })
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('appointments')
      .update({ status: 'completed' })
      .eq('status', 'scheduled')
      .lt('date', istToday)
      .select('id')

    if (error) {
      logger.error(context, error, { ...runMeta, phase: 'failed', durationMs: Date.now() - startedAt })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    const updatedCount = data?.length ?? 0
    logger.info(context, 'Run completed', {
      ...runMeta, phase: 'complete', updatedCount, durationMs: Date.now() - startedAt,
    })

    return NextResponse.json({ success: true, updatedCount, beforeDate: istToday })
  } catch (error) {
    logger.error(`${context}/unexpected`, error, { ...runMeta, phase: 'failed', durationMs: Date.now() - startedAt })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
