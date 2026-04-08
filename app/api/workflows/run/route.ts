import { type NextRequest, NextResponse } from 'next/server'
import { getClient, getInfo, setSession } from '@/app/api/utils/common'
import { InviteGateError, consumeInviteQuota } from '@/app/api/utils/invite'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      inputs,
      files,
    } = body
    const { sessionId, user } = getInfo(request)

    await consumeInviteQuota(sessionId)

    const client = getClient()
    const res = await client.runWorkflow(inputs, user, true, files)
    const response = new Response(res.data as any)
    Object.entries(setSession(sessionId)).forEach(([key, value]) => response.headers.set(key, value))
    return response
  }
  catch (error) {
    if (error instanceof InviteGateError)
      return NextResponse.json({ message: error.message }, { status: error.status })

    throw error
  }
}
