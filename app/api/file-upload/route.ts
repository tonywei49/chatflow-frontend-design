import { type NextRequest } from 'next/server'
import { difyRequest, getInfo, proxyDifyResponse } from '@/app/api/utils/common'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const { sessionId, user } = getInfo(request)

  formData.set('user', user)

  const response = await difyRequest('/files/upload', {
    method: 'POST',
    body: formData,
  })

  return proxyDifyResponse(response, sessionId)
}
