const SESSION_KEY = 'ownerMode'

/**
 * URLパラメータ ?owner=PASSCODE をサーバー側で検証し、正しければセッションに記録する。
 * パスコード自体はJSバンドルに含まれず、Netlify環境変数 OWNER_PASSCODE とのみ比較される。
 */
export async function activateOwnerModeIfValid() {
  const passcode = new URLSearchParams(window.location.search).get('owner')
  if (!passcode) return false
  try {
    const res      = await fetch(`/api/auth?owner=${encodeURIComponent(passcode)}`)
    const { ok }   = await res.json()
    if (ok) {
      sessionStorage.setItem(SESSION_KEY, '1')
      history.replaceState({}, '', window.location.pathname)
    }
    return ok
  } catch {
    return false
  }
}

export function isOwnerMode() {
  return sessionStorage.getItem(SESSION_KEY) === '1'
}
