import { type NextRequest } from 'next/server'
import { difyRequest, getInfo, proxyDifyResponse } from '@/app/api/utils/common'

export async function POST(
  request: NextRequest,
  { params }: { params: { conversationId: string } },
) {
  const body = await request.json()
  const { sessionId, user } = getInfo(request)

  const response = await difyRequest(`/conversations/${params.conversationId}/name`, {
    method: 'POST',
    body: {
      ...body,
      user,
    },
  })

  return proxyDifyResponse(response, sessionId)
}
