export function formatTime12(time: string): string {
  const [hStr, mStr] = time.split(':')
  let h = parseInt(hStr)
  const suffix = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${mStr} ${suffix}`
}
