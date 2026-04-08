import { type NextRequest } from 'next/server'
import { CompletionClient } from 'dify-client'
import { v4 } from 'uuid'
import { API_KEY, API_URL, APP_ID } from '@/config'

const userPrefix = `user_${APP_ID}:`
const SESSION_COOKIE_NAME = 'session_id'

export const getInfo = (request: NextRequest) => {
  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value || v4()
  const user = userPrefix + sessionId
  return {
    sessionId,
    user,
  }
}

export const setSession = (sessionId: string) => {
  return { 'Set-Cookie': `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; SameSite=Lax` }
}

export const client = new CompletionClient(API_KEY, API_URL || undefined)

const getApiBaseUrl = () => {
  const rawUrl = API_URL?.trim()
  if (!rawUrl)
    throw new Error('Missing NEXT_PUBLIC_API_URL')

  const normalizedUrl = new URL(rawUrl)
  const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(normalizedUrl.hostname)
  if (normalizedUrl.protocol === 'http:' && !isLocalHost)
    normalizedUrl.protocol = 'https:'

  const pathname = normalizedUrl.pathname.replace(/\/+$/, '')
  normalizedUrl.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`

  return normalizedUrl.toString().replace(/\/+$/, '')
}

export const difyRequest = async (
  path: string,
  {
    method = 'GET',
    query,
    body,
    headers,
  }: {
    method?: string
    query?: Record<string, string | number | boolean | null | undefined>
    body?: BodyInit | object
    headers?: HeadersInit
  } = {},
) => {
  const url = new URL(`${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`)
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '')
        return
      url.searchParams.set(key, String(value))
    })
  }

  const requestHeaders = new Headers(headers)
  requestHeaders.set('Authorization', `Bearer ${API_KEY}`)

  let requestBody: BodyInit | undefined
  if (body !== undefined) {
    if (body instanceof FormData || typeof body === 'string' || body instanceof URLSearchParams || body instanceof Blob) {
      requestBody = body
    }
    else {
      requestHeaders.set('Content-Type', 'application/json')
      requestBody = JSON.stringify(body)
    }
  }

  return fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody,
    cache: 'no-store',
  })
}

export const proxyDifyResponse = (response: Response, sessionId: string) => {
  const headers = new Headers()
  const contentType = response.headers.get('content-type')

  if (contentType)
    headers.set('Content-Type', contentType)

  if (response.headers.has('Cache-Control'))
    headers.set('Cache-Control', response.headers.get('Cache-Control') || 'no-store')

  Object.entries(setSession(sessionId)).forEach(([key, value]) => headers.set(key, value))

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
