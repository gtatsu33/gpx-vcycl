import { buildFit, buildWorkoutFit } from '../export/fitWriter.js'
import { RIDE_KIND, assertRideKind } from '../ride/rideKind.js'

// ライド終了時と履歴からの再アップロードで、FIT生成方式・Strava送信オプション・
// 登録名の規則を食い違わせないための共通定義。

const WORKOUT_NAME_BASE = 'gpx-vcycl workout'

export function generateRideName(routeName) {
  return `gpx-vcycl route : ${routeName}`
}

export function generateWorkoutName(workoutName) {
  return workoutName ? `${WORKOUT_NAME_BASE} : ${workoutName}` : WORKOUT_NAME_BASE
}

export const FALLBACK_WORKOUT_NAME = WORKOUT_NAME_BASE

// 履歴からの再アップロード用の既定登録名。ワークアウトは終了時に確定した
// 登録名がrouteNameへそのまま保存されている。
export function defaultUploadName(ride) {
  return assertRideKind(ride.kind) === RIDE_KIND.WORKOUT
    ? (ride.routeName || FALLBACK_WORKOUT_NAME)
    : generateRideName(ride.routeName)
}

/**
 * 種別に応じたFITと、uploadToStrava()に渡すメタ情報を作る。
 *
 * @param {object} ride  summary／保存済みレコード（kind/routeName/startedAt/endedAt/samples）
 * @param {{ name: string }} opts
 * @returns {{ fitData: Uint8Array, meta: { name: string, trainer: boolean } }}
 */
export function prepareUpload(ride, { name }) {
  if (assertRideKind(ride.kind) === RIDE_KIND.WORKOUT) {
    return {
      fitData: buildWorkoutFit({ ...ride, workoutName: name }),
      meta:    { name, trainer: true },
    }
  }
  return {
    fitData: buildFit({ ...ride, routeName: name }),
    meta:    { name, trainer: false },
  }
}
