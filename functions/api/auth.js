export async function onRequestGet(context) {
  const { request, env } = context
  const passcode = new URL(request.url).searchParams.get('owner')
  const expected = env.OWNER_PASSCODE
  if (!expected) return Response.json({ ok: false }, { status: 500 })
  return Response.json({ ok: passcode === expected })
}
