import { type NextRequest } from 'next/server'
import { difyRequest, getInfo, proxyDifyResponse } from '@/app/api/utils/common'

export async function GET(request: NextRequest) {
  const { sessionId, user } = getInfo(request)
  const { searchParams } = new URL(request.url)

  const response = await difyRequest('/conversations', {
    query: {
      user,
      last_id: searchParams.get('last_id'),
      limit: searchParams.get('limit'),
      sort_by: searchParams.get('sort_by') || '-updated_at',
    },
  })

  return proxyDifyResponse(response, sessionId)
}
