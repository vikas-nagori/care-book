import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const istToday = formatInTimeZone(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd')

    const { data, error } = await supabase
      .from('appointments')
      .update({ status: 'completed' })
      .eq('status', 'scheduled')
      .lt('date', istToday)
      .select('id')

    if (error) {
      logger.error('cron/auto-complete-appointments', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const updatedCount = data?.length ?? 0
    logger.info('cron/auto-complete-appointments', `Auto-completed ${updatedCount} appointments`, {
      updatedIds: data?.map((a) => a.id) ?? [],
      beforeDate: istToday,
    })

    return NextResponse.json({ success: true, updatedCount, beforeDate: istToday })
  } catch (error) {
    logger.error('cron/auto-complete-appointments/unexpected', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
