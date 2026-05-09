export default async (req) => {
  const passcode = new URL(req.url).searchParams.get('owner')
  const expected = process.env.OWNER_PASSCODE
  if (!expected) return Response.json({ ok: false }, { status: 500 })
  return Response.json({ ok: passcode === expected })
}

export const config = { path: '/api/auth' }
