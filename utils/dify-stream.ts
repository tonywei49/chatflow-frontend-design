export type NormalizedDifyStreamEvent =
  | {
    kind: 'message'
    text: string
    conversationId?: string
    messageId: string
    replace?: boolean
  }
  | { kind: 'workflow_started' }
  | { kind: 'workflow_finished' }
  | { kind: 'node_started' }
  | { kind: 'node_finished' }
  | { kind: 'ignore' }

const unicodeToChar = (text: string) => {
  return text.replace(/\\u([0-9a-f]{4})/gi, (_match, p1) => {
    return String.fromCharCode(Number.parseInt(p1, 16))
  })
}

export const getDifyStreamMessageId = (payload: Record<string, any>) => {
  if (typeof payload.message_id === 'string' && payload.message_id.trim())
    return payload.message_id

  if (typeof payload.id === 'string' && payload.id.trim())
    return payload.id

  return ''
}

export const normalizeDifyStreamEvent = (payload: Record<string, any>): NormalizedDifyStreamEvent => {
  const event = payload?.event

  if (event === 'message' || event === 'agent_message') {
    return {
      kind: 'message',
      text: unicodeToChar(String(payload.answer || '')),
      conversationId: payload.conversation_id,
      messageId: getDifyStreamMessageId(payload),
      replace: false,
    }
  }

  if (event === 'message_replace') {
    return {
      kind: 'message',
      text: unicodeToChar(String(payload.answer || '')),
      conversationId: payload.conversation_id,
      messageId: getDifyStreamMessageId(payload),
      replace: true,
    }
  }

  if (event === 'workflow_started')
    return { kind: 'workflow_started' }

  if (event === 'workflow_finished')
    return { kind: 'workflow_finished' }

  if (event === 'node_started')
    return { kind: 'node_started' }

  if (event === 'node_finished')
    return { kind: 'node_finished' }

  return { kind: 'ignore' }
}
