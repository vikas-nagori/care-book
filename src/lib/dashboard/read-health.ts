export type MetricRead =
  | { status: 'available'; value: number }
  | { status: 'unavailable' }

export function metricRead(value: number, errors: readonly unknown[]): MetricRead {
  return errors.some(Boolean) || !Number.isFinite(value)
    ? { status: 'unavailable' }
    : { status: 'available', value }
}
