import { type NextRequest, NextResponse } from 'next/server'
import { getInfo, setSession } from '@/app/api/utils/common'
import { InviteGateError, getInviteGateStatus } from '@/app/api/utils/invite'

export async function GET(request: NextRequest) {
  const { sessionId } = getInfo(request)

  try {
    const status = await getInviteGateStatus(sessionId)
    const response = NextResponse.json(status)
    Object.entries(setSession(sessionId)).forEach(([key, value]) => response.headers.set(key, value))
    return response
  }
  catch (error) {
    const message = error instanceof InviteGateError ? error.message : '邀请码状态读取失败。'
    const status = error instanceof InviteGateError ? error.status : 500
    const response = NextResponse.json({ message }, { status })
    Object.entries(setSession(sessionId)).forEach(([key, value]) => response.headers.set(key, value))
    return response
  }
}
