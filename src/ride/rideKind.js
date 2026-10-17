// 記録の種別。ライド記録（IndexedDB）・チェックポイント・Strava送信条件の
// 振り分けはすべてこの値で行い、他のフィールドからの推定は行わない。
export const RIDE_KIND = Object.freeze({ ROUTE: 'route', WORKOUT: 'workout' })

export function assertRideKind(kind) {
  if (!Object.values(RIDE_KIND).includes(kind)) {
    throw new Error(`Unknown ride kind: ${kind}`)
  }
  return kind
}
