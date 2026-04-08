import { type NextRequest } from 'next/server'
import { difyRequest, getInfo, proxyDifyResponse } from '@/app/api/utils/common'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { sessionId, user } = getInfo(request)

  const response = await difyRequest('/chat-messages', {
    method: 'POST',
    body: {
      ...body,
      user,
    },
  })

  return proxyDifyResponse(response, sessionId)
}
