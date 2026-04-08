import { type NextRequest, NextResponse } from 'next/server'
import { difyRequest, getInfo, proxyDifyResponse } from '@/app/api/utils/common'
import { InviteGateError, consumeInviteQuota } from '@/app/api/utils/invite'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sessionId, user } = getInfo(request)

    await consumeInviteQuota(sessionId)

    const response = await difyRequest('/chat-messages', {
      method: 'POST',
      body: {
        ...body,
        user,
      },
    })

    return proxyDifyResponse(response, sessionId)
  }
  catch (error) {
    if (error instanceof InviteGateError)
      return NextResponse.json({ message: error.message }, { status: error.status })

    throw error
  }
}
