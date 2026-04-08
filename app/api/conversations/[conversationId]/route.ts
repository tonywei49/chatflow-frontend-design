import { type NextRequest } from 'next/server'
import { difyRequest, getInfo, proxyDifyResponse } from '@/app/api/utils/common'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { conversationId: string } },
) {
  const { sessionId, user } = getInfo(request)
  const response = await difyRequest(`/conversations/${params.conversationId}`, {
    method: 'DELETE',
    body: { user },
  })

  return proxyDifyResponse(response, sessionId)
}
