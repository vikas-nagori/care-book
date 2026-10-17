import { handleBookingRequest } from '@/lib/appointments/booking-handler'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  return handleBookingRequest(request, 'create')
}
