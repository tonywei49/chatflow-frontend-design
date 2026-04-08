import { type NextRequest, NextResponse } from 'next/server'
import { getInfo, setSession } from '@/app/api/utils/common'
import { InviteGateError, activateInviteGate } from '@/app/api/utils/invite'

export async function POST(request: NextRequest) {
  const { sessionId } = getInfo(request)

  try {
    const body = await request.json()
    const status = await activateInviteGate(sessionId, typeof body?.inviteCode === 'string' ? body.inviteCode : '')
    const response = NextResponse.json(status)
    Object.entries(setSession(sessionId)).forEach(([key, value]) => response.headers.set(key, value))
    return response
  }
  catch (error) {
    const message = error instanceof InviteGateError ? error.message : '邀请码校验失败。'
    const status = error instanceof InviteGateError ? error.status : 500
    const response = NextResponse.json({ message }, { status })
    Object.entries(setSession(sessionId)).forEach(([key, value]) => response.headers.set(key, value))
    return response
  }
}
