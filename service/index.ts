import type { IOnCompleted, IOnData, IOnError, IOnNodeFinished, IOnNodeStarted, IOnWorkflowFinished, IOnWorkflowStarted } from './base'
import { del, get, post, ssePost, upload } from './base'
import type {
  AppParametersResponse,
  ConversationListResponse,
  ConversationMessageListResponse,
  Feedbacktype,
  InviteGateStatus,
  UploadedFile,
} from '@/types/app'

export const sendChatMessage = async (body: Record<string, any>, { onData, onCompleted, onError }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
}) => {
  return ssePost('chat-messages', {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, onError })
}

export const sendWorkflowMessage = async (
  body: Record<string, any>,
  {
    onWorkflowStarted,
    onNodeStarted,
    onNodeFinished,
    onWorkflowFinished,
  }: {
    onWorkflowStarted: IOnWorkflowStarted
    onNodeStarted: IOnNodeStarted
    onNodeFinished: IOnNodeFinished
    onWorkflowFinished: IOnWorkflowFinished
  },
) => {
  return ssePost('workflows/run', {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onNodeStarted, onWorkflowStarted, onWorkflowFinished, onNodeFinished })
}

export const fetchAppParams = async () => {
  return get('parameters') as Promise<AppParametersResponse>
}

export const fetchInviteGateStatus = async () => {
  return get('invite/status') as Promise<InviteGateStatus>
}

export const activateInviteCode = async (inviteCode: string) => {
  return post('invite/activate', {
    body: { inviteCode },
  }) as Promise<InviteGateStatus>
}

export const fetchConversations = async (params?: {
  last_id?: string
  limit?: number
  sort_by?: string
}) => {
  return get('conversations', {
    params,
  }) as Promise<ConversationListResponse>
}

export const fetchConversationMessages = async (conversationId: string, params?: {
  first_id?: string
  limit?: number
}) => {
  return get('messages', {
    params: {
      conversation_id: conversationId,
      ...params,
    },
  }) as Promise<ConversationMessageListResponse>
}

export const renameConversation = async (conversationId: string, body: {
  name?: string
  auto_generate?: boolean
}) => {
  return post(`/conversations/${conversationId}/name`, {
    body,
  })
}

export const deleteConversation = async (conversationId: string) => {
  return del(`/conversations/${conversationId}`)
}

export const uploadChatFile = async ({
  file,
  onProgress,
}: {
  file: File
  onProgress?: (event: ProgressEvent) => void
}) => {
  const formData = new FormData()
  formData.append('file', file)

  return upload({
    xhr: new XMLHttpRequest(),
    data: formData,
    onprogress: onProgress,
  }) as Promise<UploadedFile>
}

export const updateFeedback = async ({ url, body }: { url: string; body: Feedbacktype }) => {
  return post(url, { body })
}
