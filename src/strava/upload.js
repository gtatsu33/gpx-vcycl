import { getValidAccessToken } from './auth.js'

const POLL_INTERVAL_MS = 5000
const POLL_MAX_TRIES   = 12  // 最大60秒待つ

/**
 * FITファイルをStravaにアップロードする。
 * アップロード受付後、アクティビティIDが確定するまでポーリングする。
 *
 * @param {Uint8Array} fitData
 * @param {{ name: string }} meta
 * @returns {Promise<string>} Strava activity ID
 */
export async function uploadToStrava(fitData, { name }) {
  const token    = await getValidAccessToken()
  const formData = new FormData()
  formData.append('file',      new Blob([fitData], { type: 'application/octet-stream' }), 'ride.fit')
  formData.append('data_type', 'fit')
  formData.append('name',      name)
  formData.append('trainer',   '1')
  formData.append('commute',   '0')

  const res = await fetch('https://www.strava.com/api/v3/uploads', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    formData,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upload failed: ${res.status} ${text}`)
  }
  const { id_str: uploadId } = await res.json()

  // アクティビティが処理されるまでポーリング
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    await sleep(POLL_INTERVAL_MS)
    const status = await checkUploadStatus(uploadId)
    if (status.activityId) return status.activityId
    if (status.error)      throw new Error(`Strava processing error: ${status.error}`)
  }
  throw new Error('Strava processing timed out')
}

async function checkUploadStatus(uploadId) {
  const token = await getValidAccessToken()
  const res   = await fetch(`https://www.strava.com/api/v3/uploads/${uploadId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`)
  const data = await res.json()
  return {
    activityId: data.activity_id ? String(data.activity_id) : null,
    error:      data.error ?? null,
    status:     data.status,
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
