'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bars3Icon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { APP_ID, APP_INFO } from '@/config'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import {
  activateInviteCode,
  deleteConversation,
  fetchAppParams,
  fetchConversationMessages,
  fetchConversations,
  fetchInviteGateStatus,
  renameConversation,
  sendChatMessage,
  uploadChatFile,
} from '@/service'
import type {
  AppParametersResponse,
  ChatAttachment,
  ConversationItem,
  ConversationMessage,
  FileUploadCategory,
  FileUploadConfig,
  InviteGateStatus,
  PromptVariable,
  UnsupportedPromptVariable,
} from '@/types/app'
import { TransferMethod } from '@/types/app'
import Toast from '@/app/components/base/toast'
import { createPromptInputDefaults, inspectUserInputsForm, replaceVarWithValues } from '@/utils/prompt'

type WorkspaceMode = 'setup' | 'chat'

type RenderMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  pending?: boolean
  error?: boolean
}

type InviteActivationState = InviteGateStatus & {
  code: string
  error: string | null
  isSubmitting: boolean
}

const MULTI_TURN_DISABLED_MARKER = '--------测试版本不支持多轮对话--------'

const FILE_EXTENSION_MAP: Record<FileUploadCategory, string[]> = {
  document: ['.txt', '.md', '.markdown', '.mdx', '.pdf', '.html', '.xlsx', '.xls', '.vtt', '.properties', '.doc', '.docx', '.csv', '.eml', '.msg', '.pptx', '.ppt', '.xml', '.epub'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
  audio: ['.mp3', '.m4a', '.wav', '.webm', '.mpga', '.amr'],
  video: ['.mp4', '.mov', '.mpeg', '.webm'],
  custom: [],
}

const FILE_TYPE_LABELS: Record<FileUploadCategory, string> = {
  document: '文档',
  image: '图片',
  audio: '音频',
  video: '视频',
  custom: '自定义文件',
}

const IMAGE_EXTENSIONS = new Set(FILE_EXTENSION_MAP.image)

const formatRelativeTime = (timestamp?: number) => {
  if (!timestamp)
    return ''

  const target = timestamp * 1000
  const diffMs = target - Date.now()
  const diffMinutes = Math.round(diffMs / 60000)
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

  if (Math.abs(diffMinutes) < 60)
    return formatter.format(diffMinutes, 'minute')

  const diffHours = Math.round(diffMs / 3600000)
  if (Math.abs(diffHours) < 24)
    return formatter.format(diffHours, 'hour')

  const diffDays = Math.round(diffMs / 86400000)
  return formatter.format(diffDays, 'day')
}

const formatFileSize = (size: number) => {
  if (size < 1024)
    return `${size} B`
  if (size < 1024 * 1024)
    return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const getFileExtension = (name: string) => {
  const index = name.lastIndexOf('.')
  if (index === -1)
    return ''
  return name.slice(index).toLowerCase()
}

const inferFileType = (file: File): FileUploadCategory => {
  const extension = getFileExtension(file.name)
  const mimeType = file.type.toLowerCase()

  if (mimeType.startsWith('image/') || FILE_EXTENSION_MAP.image.includes(extension))
    return 'image'
  if (mimeType.startsWith('audio/') || FILE_EXTENSION_MAP.audio.includes(extension))
    return 'audio'
  if (mimeType.startsWith('video/') || FILE_EXTENSION_MAP.video.includes(extension))
    return 'video'
  if (FILE_EXTENSION_MAP.document.includes(extension))
    return 'document'
  return 'custom'
}

const buildMessagesFromHistory = (items: ConversationMessage[]) => {
  return [...items]
    .sort((a, b) => a.created_at - b.created_at)
    .flatMap<RenderMessage>((item) => {
    const entries: RenderMessage[] = []
    if (item.query) {
      entries.push({
        id: `${item.id}-user`,
        role: 'user',
        content: item.query,
        createdAt: item.created_at,
      })
    }
    if (item.answer) {
      entries.push({
        id: item.id,
        role: 'assistant',
        content: item.answer,
        createdAt: item.created_at,
      })
    }
    return entries
  })
}

const getErrorMessage = async (error: unknown) => {
  if (error instanceof Response) {
    try {
      const data = await error.clone().json()
      if (typeof data?.message === 'string' && data.message.trim())
        return data.message
    }
    catch {}

    try {
      const text = await error.text()
      if (text.trim())
        return text
    }
    catch {}

    return `请求失败 (${error.status})`
  }

  if (error instanceof Error)
    return error.message

  if (typeof error === 'string')
    return error

  return '请求失败'
}

const mergeInputsWithDefaults = (
  promptVariables: PromptVariable[],
  nextInputs?: Record<string, string | number>,
) => {
  return {
    ...createPromptInputDefaults(promptVariables),
    ...(nextInputs || {}),
  }
}

const buildAttachmentAcceptList = (config?: FileUploadConfig | null) => {
  if (!config?.enabled)
    return []

  const configuredExtensions = (config.allowed_file_extensions || [])
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)

  const allowedTypes = config.allowed_file_types || []
  const collected = new Set<string>()

  if (!allowedTypes.length && configuredExtensions.length)
    configuredExtensions.forEach(item => collected.add(item))

  allowedTypes.forEach((type) => {
    const matchedExtensions = configuredExtensions.filter(ext => FILE_EXTENSION_MAP[type].includes(ext))
    const finalExtensions = matchedExtensions.length > 0 ? matchedExtensions : FILE_EXTENSION_MAP[type]
    finalExtensions.forEach(ext => collected.add(ext))
  })

  return [...collected]
}

const getAttachmentLimit = (config?: FileUploadConfig | null) => {
  return config?.number_limits || 3
}

const getFileSizeLimitMb = (type: FileUploadCategory, parameters?: AppParametersResponse | null) => {
  const system = parameters?.file_upload?.fileUploadConfig || parameters?.system_parameters
  if (!system)
    return undefined

  if (type === 'image')
    return system.image_file_size_limit
  if (type === 'audio')
    return system.audio_file_size_limit
  if (type === 'video')
    return system.video_file_size_limit
  return system.file_size_limit
}

const ChatWorkspace = () => {
  const media = useBreakpoints()
  const isCompact = media !== MediaType.pc

  const [isLoading, setIsLoading] = useState(true)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [promptVariables, setPromptVariables] = useState<PromptVariable[]>([])
  const [unsupportedVariables, setUnsupportedVariables] = useState<UnsupportedPromptVariable[]>([])
  const [parameters, setParameters] = useState<AppParametersResponse | null>(null)
  const [openingStatement, setOpeningStatement] = useState('')
  const [currentInputs, setCurrentInputs] = useState<Record<string, string | number>>({})
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<RenderMessage[]>([])
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('setup')
  const [hasEnteredChat, setHasEnteredChat] = useState(false)
  const [draft, setDraft] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeMenuConversationId, setActiveMenuConversationId] = useState<string | null>(null)
  const [renameState, setRenameState] = useState<{ id: string; value: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ConversationItem | null>(null)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false)
  const [inviteGate, setInviteGate] = useState<InviteActivationState>({
    enabled: false,
    activated: false,
    remaining: null,
    quota: null,
    code: '',
    error: null,
    isSubmitting: false,
  })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const currentConversationIdRef = useRef<string | null>(null)
  const currentInputsRef = useRef<Record<string, string | number>>({})
  const attachmentsRef = useRef<ChatAttachment[]>([])

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId
  }, [currentConversationId])

  useEffect(() => {
    currentInputsRef.current = currentInputs
  }, [currentInputs])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    if (APP_INFO?.title)
      document.title = `${APP_INFO.title} - Powered by Dify`
  }, [])

  useEffect(() => {
    if (!isCompact || typeof window === 'undefined') {
      setViewportHeight(null)
      setIsKeyboardVisible(false)
      document.documentElement.style.removeProperty('--app-viewport-height')
      document.documentElement.style.removeProperty('--app-viewport-width')
      return
    }

    const viewport = window.visualViewport
    const updateViewport = () => {
      const nextHeight = Math.round(viewport?.height ?? window.innerHeight)
      const nextWidth = Math.round(viewport?.width ?? window.innerWidth)
      const baselineHeight = window.innerHeight
      setViewportHeight(nextHeight)
      setIsKeyboardVisible(baselineHeight - nextHeight > 120)
      document.documentElement.style.setProperty('--app-viewport-height', `${nextHeight}px`)
      document.documentElement.style.setProperty('--app-viewport-width', `${nextWidth}px`)
    }

    updateViewport()

    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', updateViewport)

    return () => {
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
      document.documentElement.style.removeProperty('--app-viewport-height')
      document.documentElement.style.removeProperty('--app-viewport-width')
    }
  }, [isCompact])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isSending])

  useEffect(() => {
    if (!isCompact || !(isComposerFocused || isKeyboardVisible))
      return

    const timer = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, 120)

    return () => window.clearTimeout(timer)
  }, [isCompact, isComposerFocused, isKeyboardVisible])

  const canBoot = Boolean(APP_ID)

  const fileUploadConfig = parameters?.file_upload || null
  const attachmentAcceptList = useMemo(() => buildAttachmentAcceptList(fileUploadConfig), [fileUploadConfig])
  const attachmentAccept = attachmentAcceptList.join(',')
  const attachmentLimit = getAttachmentLimit(fileUploadConfig)
  const fileUploadEnabled = Boolean(fileUploadConfig?.enabled)
  const localUploadEnabled = fileUploadEnabled
    && (fileUploadConfig?.allowed_file_upload_methods || []).includes(TransferMethod.local_file)

  const allowedFileTypes = useMemo<FileUploadCategory[]>(() => {
    const nextTypes = fileUploadConfig?.allowed_file_types || []
    if (nextTypes.length)
      return nextTypes

    const nestedTypes = (['document', 'image', 'audio', 'video', 'custom'] as FileUploadCategory[])
      .filter(type => fileUploadConfig?.[type]?.enabled)
    return nestedTypes
  }, [fileUploadConfig])

  const availableFileTypesLabel = useMemo(() => {
    if (!allowedFileTypes.length)
      return ''
    return allowedFileTypes.map(type => FILE_TYPE_LABELS[type]).join('、')
  }, [allowedFileTypes])

  const resolvedOpeningStatement = useMemo(() => {
    if (!openingStatement)
      return ''

    return replaceVarWithValues(openingStatement, promptVariables, currentInputs)
  }, [currentInputs, openingStatement, promptVariables])

  const isCompactConstrainedViewport = isCompact && typeof viewportHeight === 'number' && viewportHeight < 720
  const isCompactComposerMode = isCompact && workspaceMode === 'chat' && (isComposerFocused || isKeyboardVisible || isCompactConstrainedViewport)
  const workspaceViewportStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!isCompact)
      return undefined

    const nextHeight = viewportHeight ? `${viewportHeight}px` : '100dvh'
    return {
      height: nextHeight,
      minHeight: nextHeight,
    }
  }, [isCompact, viewportHeight])
  const isUploadingAttachments = attachments.some(item => item.status === 'uploading')
  const isMultiTurnLocked = useMemo(() => {
    const lastAssistantMessage = [...messages].reverse().find(item => item.role === 'assistant')
    return Boolean(lastAssistantMessage?.content?.includes(MULTI_TURN_DISABLED_MARKER))
  }, [messages])

  const refreshConversations = async (_preferredConversationId?: string | null) => {
    const response = await fetchConversations({
      limit: 50,
      sort_by: '-updated_at',
    })
    const nextConversations = response.data || []
    setConversations(nextConversations)
  }

  const refreshInviteGate = useCallback(async () => {
    const status = await fetchInviteGateStatus()
    setInviteGate(prev => ({
      ...prev,
      ...status,
      error: null,
      isSubmitting: false,
      code: status.activated ? '' : prev.code,
    }))
    return status
  }, [])

  const bootstrap = useCallback(async () => {
    if (!canBoot) {
      setFatalError('缺少前端公开配置，请先设置 NEXT_PUBLIC_APP_ID。Dify 的 API Key 与 API URL 需要放在服务端环境变量 DIFY_API_KEY、DIFY_API_URL。')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setFatalError(null)

    try {
      const [parametersResponse, conversationsResponse, inviteGateStatus] = await Promise.all([
        fetchAppParams(),
        fetchConversations({
          limit: 50,
          sort_by: '-updated_at',
        }),
        refreshInviteGate(),
      ])

      const { promptVariables, unsupportedVariables } = inspectUserInputsForm(parametersResponse?.user_input_form || [])
      setParameters(parametersResponse)
      setOpeningStatement(parametersResponse?.opening_statement?.trim() || '')
      setPromptVariables(promptVariables)
      setUnsupportedVariables(unsupportedVariables)
      setCurrentInputs(mergeInputsWithDefaults(promptVariables))
      setConversations(conversationsResponse.data || [])
      setInviteGate(prev => ({
        ...prev,
        ...inviteGateStatus,
        error: null,
        isSubmitting: false,
      }))
    }
    catch (error) {
      setFatalError(await getErrorMessage(error))
    }
    finally {
      setIsLoading(false)
    }
  }, [canBoot, refreshInviteGate])

  useEffect(() => {
    bootstrap().catch(() => {})
  }, [bootstrap])

  const unsupportedMessage = useMemo(() => {
    if (!unsupportedVariables.length)
      return null

    return unsupportedVariables
      .map(item => `${item.name}（${item.type}）`)
      .join('、')
  }, [unsupportedVariables])

  const validateInputs = () => {
    const missingField = promptVariables.find((item) => {
      if (!item.required)
        return false

      const value = currentInputsRef.current[item.key]
      return value === '' || value === undefined || value === null
    })

    if (missingField) {
      Toast.notify({
        type: 'error',
        message: `请先填写“${missingField.name}”`,
      })
      return false
    }

    if (unsupportedVariables.length) {
      Toast.notify({
        type: 'error',
        message: '当前 Dify 变量中存在前端未支持的字段类型，请先处理后再使用。',
      })
      return false
    }

    return true
  }

  const validateAttachments = () => {
    if (attachmentsRef.current.some(item => item.status === 'uploading')) {
      Toast.notify({
        type: 'info',
        message: '附件还在上传中，请等待上传完成后再发送。',
      })
      return false
    }

    const errorAttachment = attachmentsRef.current.find(item => item.status === 'error')
    if (errorAttachment) {
      Toast.notify({
        type: 'error',
        message: `附件“${errorAttachment.name}”上传失败，请移除后重新上传。`,
      })
      return false
    }

    return true
  }

  const handleNewConversation = () => {
    setCurrentConversationId(null)
    setMessages([])
    setDraft('')
    setAttachments([])
    setHasEnteredChat(false)
    setWorkspaceMode('setup')
    setCurrentInputs(mergeInputsWithDefaults(promptVariables))
    setActiveMenuConversationId(null)
    setSidebarOpen(false)
  }

  const handleSelectConversation = async (conversation: ConversationItem) => {
    setSidebarOpen(false)
    setActiveMenuConversationId(null)
    setIsLoadingMessages(true)
    setAttachments([])

    try {
      const response = await fetchConversationMessages(conversation.id, {
        limit: 100,
      })

      setCurrentConversationId(conversation.id)
      setCurrentInputs(mergeInputsWithDefaults(promptVariables, conversation.inputs))
      setMessages(buildMessagesFromHistory(response.data || []))
      setHasEnteredChat(true)
      setWorkspaceMode('chat')
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: await getErrorMessage(error),
      })
    }
    finally {
      setIsLoadingMessages(false)
    }
  }

  const handleStartChat = () => {
    if (inviteGate.enabled && !inviteGate.activated) {
      Toast.notify({
        type: 'info',
        message: '请先输入邀请码，再开始聊天。',
      })
      return
    }

    if (!validateInputs())
      return
    setHasEnteredChat(true)
    setWorkspaceMode('chat')
    setSidebarOpen(false)
  }

  const handleEditSettings = () => {
    setWorkspaceMode('setup')
    setSidebarOpen(false)
  }

  const handleRemoveAttachment = (localId: string) => {
    setAttachments(prev => prev.filter(item => item.localId !== localId))
  }

  const uploadSingleFile = async (file: File) => {
    const extension = getFileExtension(file.name)
    const fileType = inferFileType(file)
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    if (!allowedFileTypes.includes(fileType)) {
      Toast.notify({
        type: 'error',
        message: `当前 Dify 应用未开放 ${FILE_TYPE_LABELS[fileType]} 上传：${file.name}`,
      })
      return
    }

    const maxSizeMb = getFileSizeLimitMb(fileType, parameters)
    if (maxSizeMb && file.size > maxSizeMb * 1024 * 1024) {
      Toast.notify({
        type: 'error',
        message: `附件“${file.name}”超过 ${maxSizeMb} MB 限制。`,
      })
      return
    }

    setAttachments(prev => [
      ...prev,
      {
        localId,
        name: file.name,
        size: file.size,
        extension,
        mimeType: file.type,
        fileType,
        progress: 0,
        status: 'uploading',
      },
    ])

    try {
      const response = await uploadChatFile({
        file,
        onProgress: (event) => {
          if (!event.lengthComputable)
            return

          const progress = Math.max(1, Math.min(99, Math.round(event.loaded / event.total * 100)))
          setAttachments(prev => prev.map(item => item.localId === localId ? { ...item, progress } : item))
        },
      })

      setAttachments(prev => prev.map((item) => {
        if (item.localId !== localId)
          return item

        return {
          ...item,
          progress: 100,
          status: 'uploaded',
          uploadFileId: response.id,
          extension: response.extension ? `.${response.extension.replace(/^\./, '').toLowerCase()}` : item.extension,
          mimeType: response.mime_type || item.mimeType,
        }
      }))
    }
    catch (error) {
      setAttachments(prev => prev.map(item => item.localId === localId
        ? {
          ...item,
          status: 'error',
          progress: 0,
          errorMessage: error instanceof Error ? error.message : '上传失败',
        }
        : item))

      Toast.notify({
        type: 'error',
        message: await getErrorMessage(error),
      })
    }
  }

  const handleAttachmentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files || [])
    event.target.value = ''

    if (!nextFiles.length)
      return

    if (!fileUploadEnabled) {
      Toast.notify({
        type: 'error',
        message: '当前 Dify 应用没有开启附件上传。',
      })
      return
    }

    if (!localUploadEnabled) {
      Toast.notify({
        type: 'error',
        message: '当前 Dify 应用未开放本地文件上传，只允许远程链接。',
      })
      return
    }

    const nextTotal = attachmentsRef.current.length + nextFiles.length
    if (nextTotal > attachmentLimit) {
      Toast.notify({
        type: 'error',
        message: `当前 Dify 应用最多允许上传 ${attachmentLimit} 个附件。`,
      })
      return
    }

    await Promise.all(nextFiles.map(file => uploadSingleFile(file)))
  }

  const handleSendMessage = async () => {
    const content = draft.trim()
    if (!content || isSending)
      return

    if (isMultiTurnLocked) {
      Toast.notify({
        type: 'info',
        message: '测试版本不支持多轮对话。',
      })
      return
    }

    if (inviteGate.enabled && !inviteGate.activated) {
      Toast.notify({
        type: 'error',
        message: '请先输入邀请码，再发送消息。',
      })
      return
    }

    if (inviteGate.enabled && typeof inviteGate.remaining === 'number' && inviteGate.remaining <= 0) {
      Toast.notify({
        type: 'error',
        message: '当前邀请码次数已用完。',
      })
      return
    }

    if (!validateInputs() || !validateAttachments())
      return

    const uploadedAttachments = attachmentsRef.current.filter(item => item.status === 'uploaded' && item.uploadFileId)
    const attachmentSummary = uploadedAttachments.length
      ? `\n\n附件：${uploadedAttachments.map(item => item.name).join('、')}`
      : ''

    const createdAt = Math.floor(Date.now() / 1000)
    const userMessageId = `user-${Date.now()}`
    const assistantMessageId = `assistant-${Date.now()}`
    const previousConversationId = currentConversationIdRef.current

    setDraft('')
    setWorkspaceMode('chat')
    setIsSending(true)
    setMessages(prev => ([
      ...prev,
      {
        id: userMessageId,
        role: 'user',
        content: `${content}${attachmentSummary}`,
        createdAt,
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt,
        pending: true,
      },
    ]))

    let streamConversationId = previousConversationId
    let streamMessageId = assistantMessageId

    await sendChatMessage({
      inputs: currentInputsRef.current,
      query: content,
      conversation_id: previousConversationId || undefined,
      files: uploadedAttachments.map(item => ({
        type: item.fileType,
        transfer_method: TransferMethod.local_file,
        upload_file_id: item.uploadFileId,
      })),
      response_mode: 'streaming',
    }, {
      onData: (chunk, isFirstMessage, moreInfo) => {
        if (moreInfo.conversationId && !streamConversationId) {
          streamConversationId = moreInfo.conversationId
          setCurrentConversationId(moreInfo.conversationId)
        }

        if (moreInfo.messageId)
          streamMessageId = moreInfo.messageId

        setMessages((prev) => {
          const nextMessages = [...prev]
          const targetIndex = nextMessages.findIndex(item => item.id === assistantMessageId || item.id === streamMessageId)
          if (targetIndex === -1)
            return prev

          nextMessages[targetIndex] = {
            ...nextMessages[targetIndex],
            id: streamMessageId,
            content: `${isFirstMessage ? '' : nextMessages[targetIndex].content}${chunk}`,
            pending: false,
          }
          return nextMessages
        })
      },
      onCompleted: async () => {
        setIsSending(false)
        setAttachments([])
        await refreshInviteGate()
        await refreshConversations(streamConversationId)
      },
      onError: async (message) => {
        setIsSending(false)
        setMessages(prev => prev.map(item => item.id === assistantMessageId
          ? {
            ...item,
            pending: false,
            error: true,
            content: item.content || (typeof message === 'string' ? message : '对话发送失败'),
          }
          : item))
        await refreshInviteGate().catch(() => {})
      },
    })
  }

  const handleActivateInvite = async () => {
    const inviteCode = inviteGate.code.trim()
    if (!inviteCode) {
      setInviteGate(prev => ({ ...prev, error: '请输入邀请码。' }))
      return
    }

    setInviteGate(prev => ({ ...prev, isSubmitting: true, error: null }))

    try {
      const status = await activateInviteCode(inviteCode)
      setInviteGate({
        ...status,
        code: '',
        error: null,
        isSubmitting: false,
      })
      Toast.notify({
        type: 'success',
        message: `邀请码已生效，当前剩余 ${status.remaining ?? 0} 次。`,
      })
    }
    catch (error) {
      const message = await getErrorMessage(error)
      setInviteGate(prev => ({
        ...prev,
        error: message,
        isSubmitting: false,
      }))
    }
  }

  const handleRenameConversation = async () => {
    if (!renameState)
      return

    const nextName = renameState.value.trim()
    if (!nextName) {
      Toast.notify({
        type: 'error',
        message: '会话名称不能为空',
      })
      return
    }

    try {
      await renameConversation(renameState.id, {
        name: nextName,
        auto_generate: false,
      })
      await refreshConversations(renameState.id)
      setRenameState(null)
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: await getErrorMessage(error),
      })
    }
  }

  const handleDeleteConversation = async () => {
    if (!deleteTarget)
      return

    try {
      await deleteConversation(deleteTarget.id)
      if (currentConversationIdRef.current === deleteTarget.id)
        handleNewConversation()
      await refreshConversations(null)
      setDeleteTarget(null)
    }
    catch (error) {
      Toast.notify({
        type: 'error',
        message: await getErrorMessage(error),
      })
    }
  }

  const renderVariableField = (variable: PromptVariable) => {
    const value = currentInputs[variable.key] ?? ''
    const baseInputClassName = 'w-full rounded-2xl border border-[#e4e7ee] bg-[#f8f9fc] px-4 py-3 text-sm text-[#111827] outline-none transition focus:border-[#4a67f5] focus:bg-white'

    if (variable.type === 'select') {
      return (
        <select
          value={String(value)}
          onChange={event => setCurrentInputs(prev => ({ ...prev, [variable.key]: event.target.value }))}
          className={baseInputClassName}
        >
          <option value="">请选择</option>
          {(variable.options || []).map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      )
    }

    if (variable.type === 'paragraph') {
      return (
        <textarea
          value={String(value)}
          onChange={event => setCurrentInputs(prev => ({ ...prev, [variable.key]: event.target.value }))}
          className={`${baseInputClassName} min-h-[120px] resize-y`}
          maxLength={variable.max_length}
          placeholder={`请输入${variable.name}`}
        />
      )
    }

    return (
      <input
        value={String(value)}
        onChange={(event) => {
          const nextValue = variable.type === 'number' ? event.target.value.replace(/[^\d.-]/g, '') : event.target.value
          setCurrentInputs(prev => ({ ...prev, [variable.key]: nextValue }))
        }}
        type={variable.type === 'number' ? 'number' : 'text'}
        className={baseInputClassName}
        maxLength={variable.max_length}
        placeholder={`请输入${variable.name}`}
      />
    )
  }

  const sidebar = (
    <aside className="flex h-full w-full max-w-[288px] flex-col border-r border-[#e6e8ef] bg-[#eef1f7]">
      <div className="border-b border-[#e0e5f0] px-4 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ffe0b8] to-[#ffba6d] text-[#5d3b00] shadow-sm">
            <ChatBubbleLeftRightIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[#243041]">{APP_INFO.title}</div>
            <div className="text-xs text-[#7b8496]">{conversations.length} 个会话</div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleNewConversation}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#dce1ee] bg-white px-4 py-3 text-sm font-medium text-[#315efb] transition hover:border-[#cfd6ea] hover:bg-[#fbfcff]"
        >
          <PlusIcon className="h-4 w-4" />
          <span>开启新对话</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {conversations.length === 0
          ? (
            <div className="rounded-2xl border border-dashed border-[#d8deeb] px-4 py-5 text-sm text-[#7b8496]">
                还没有会话记录。发送第一条消息后，这里会显示真实 Dify 会话。
            </div>
          )
          : (
            <div className="space-y-2">
              {conversations.map((conversation) => {
                const isActive = currentConversationId === conversation.id
                return (
                  <div
                    key={conversation.id}
                    className={`group rounded-2xl border px-3 py-3 transition ${
                      isActive
                        ? 'border-[#d3dafd] bg-white shadow-[0_8px_24px_rgba(49,94,251,0.08)]'
                        : 'border-transparent bg-white/60 hover:border-[#dde3f0] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => handleSelectConversation(conversation)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-medium text-[#243041]">{conversation.name || '未命名会话'}</div>
                        <div className="mt-1 text-xs text-[#8a93a6]">{formatRelativeTime(conversation.updated_at)}</div>
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setActiveMenuConversationId(prev => prev === conversation.id ? null : conversation.id)}
                          className="rounded-xl p-1.5 text-[#8a93a6] transition hover:bg-[#edf1fa] hover:text-[#344054]"
                        >
                          <EllipsisHorizontalIcon className="h-5 w-5" />
                        </button>
                        {activeMenuConversationId === conversation.id && (
                          <div className="absolute right-0 top-9 z-20 w-36 rounded-2xl border border-[#dde3f0] bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.12)]">
                            <button
                              type="button"
                              onClick={() => {
                                setRenameState({ id: conversation.id, value: conversation.name || '' })
                                setActiveMenuConversationId(null)
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#344054] transition hover:bg-[#f5f7fb]"
                            >
                              <PencilSquareIcon className="h-4 w-4" />
                              <span>重命名</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteTarget(conversation)
                                setActiveMenuConversationId(null)
                              }}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#d92d20] transition hover:bg-[#fff4f2]"
                            >
                              <TrashIcon className="h-4 w-4" />
                              <span>删除</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      <div className="px-4 py-4 text-xs text-[#8a93a6]">Powered by Dify</div>
    </aside>
  )

  const renderSetupView = () => (
    <div className="flex h-full items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-3xl rounded-[28px] border border-[#e6e9f0] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="flex items-center gap-3 border-b border-[#eef1f6] px-6 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#4a67f5] text-white">
            <ChatBubbleLeftRightIcon className="h-4 w-4" />
          </div>
          <div className="flex-1 text-lg font-semibold text-[#243041]">新对话设置</div>
        </div>

        <div className="space-y-6 px-6 py-6">
          {unsupportedMessage && (
            <div className="rounded-2xl border border-[#f7c5be] bg-[#fff6f4] px-4 py-3 text-sm text-[#9a3412]">
              检测到当前 Dify 应用包含前端尚未支持的字段类型：{unsupportedMessage}。页面不会偷偷降级为其它控件，请先处理这些字段。
            </div>
          )}

          {promptVariables.length === 0
            ? (
              <div className="rounded-2xl border border-dashed border-[#d9dfeb] bg-[#fafbfe] px-4 py-5 text-sm text-[#667085]">
                  当前 Dify 应用没有配置新对话变量。你可以直接进入聊天视图发送第一条消息。
              </div>
            )
            : (
              <div className="grid gap-5 md:grid-cols-2">
                {promptVariables.map(variable => (
                  <label
                    key={variable.key}
                    className={`block ${variable.type === 'paragraph' ? 'md:col-span-2' : ''}`}
                  >
                    <div className="mb-2 flex items-center gap-1 text-sm font-medium text-[#243041]">
                      <span>{variable.name}</span>
                      {variable.required && <span className="text-[#315efb]">*</span>}
                    </div>
                    {renderVariableField(variable)}
                  </label>
                ))}
              </div>
            )}
        </div>

        <div className="border-t border-[#eef1f6] px-6 py-5">
          <button
            type="button"
            onClick={handleStartChat}
            disabled={unsupportedVariables.length > 0}
            className="w-full rounded-2xl bg-[#3e63f5] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#3557df] disabled:cursor-not-allowed disabled:bg-[#9fb0f8]"
          >
            {hasEnteredChat ? '保存并返回对话' : '开始对话'}
          </button>
        </div>
      </div>
    </div>
  )

  const renderChatView = () => (
    <div className="flex h-full min-h-0 flex-col">
      {!isCompactComposerMode && (
        <div className="border-b border-[#eef1f6] bg-white/80 px-4 py-3 md:px-6">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded-[22px] border border-[#eef1f6] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4a67f5] text-white">
                  <ChatBubbleLeftRightIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 truncate text-[15px] font-semibold text-[#243041]">新对话设置</div>
              </div>
              <button
                type="button"
                onClick={handleEditSettings}
                className="shrink-0 rounded-2xl px-3 py-1.5 text-sm font-semibold text-[#4a67f5] transition hover:bg-[#f2f5ff]"
              >
                编辑
              </button>
            </div>

            {inviteGate.enabled && inviteGate.activated && (
              <div className="shrink-0 rounded-2xl border border-[#d7def8] bg-white px-3 py-2 text-xs font-semibold text-[#4a67f5] shadow-[0_10px_30px_rgba(15,23,42,0.04)] md:px-4 md:text-sm">
                剩余次数：{inviteGate.remaining ?? 0}/{inviteGate.quota ?? 0}
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto px-4 ${isCompactComposerMode ? 'py-3' : 'py-6'} md:px-6`}>
        {isLoadingMessages
          ? (
            <div className="flex h-full items-center justify-center text-sm text-[#8a93a6]">正在加载会话内容…</div>
          )
          : messages.length === 0
            ? (
              <div className="flex h-full items-center justify-center">
                {isCompactComposerMode
                  ? <div ref={messagesEndRef} />
                  : resolvedOpeningStatement
                    ? (
                      <div className="max-w-xl text-center">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ffe7cc] text-[#8a4b08] shadow-sm">
                          <ChatBubbleLeftRightIcon className="h-6 w-6" />
                        </div>
                        <p className="text-[18px] font-medium leading-[1.85] text-[#5b6475] md:text-[22px]">
                          {resolvedOpeningStatement}
                        </p>
                      </div>
                    )
                    : (
                      <div className="max-w-xl rounded-[28px] border border-dashed border-[#dbe1ee] bg-white/80 px-6 py-8 text-center shadow-[0_16px_50px_rgba(15,23,42,0.04)]">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eef2ff] text-[#4a67f5]">
                          <PaperAirplaneIcon className="h-6 w-6" />
                        </div>
                        <div className="text-lg font-semibold text-[#243041]">开始第一轮对话</div>
                        <p className="mt-3 text-base leading-8 text-[#5b6475]">
                        左侧会话列表会在消息发出后自动出现真实 Dify 会话。手机端默认以聊天窗口为主，列表会收进抽屉里。
                        </p>
                        {fileUploadEnabled && (
                          <p className="mt-3 text-sm leading-6 text-[#8a93a6]">
                          已同步 Dify 附件能力：支持 {availableFileTypesLabel}，最多 {attachmentLimit} 个附件。
                          </p>
                        )}
                      </div>
                    )}
              </div>
            )
            : (
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
                {messages.map(message => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[86%] rounded-[24px] px-4 py-3 text-sm leading-7 shadow-sm md:max-w-[76%] ${
                        message.role === 'user'
                          ? 'rounded-br-md bg-[#3e63f5] text-white'
                          : message.error
                            ? 'rounded-bl-md border border-[#f4c7c3] bg-[#fff6f4] text-[#912018]'
                            : 'rounded-bl-md border border-[#e5e7ef] bg-white text-[#243041]'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{message.content || (message.pending ? '正在生成回复…' : '')}</div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
      </div>

      <div className="sticky bottom-0 z-10 border-t border-[#eaedf4] bg-white/92 px-4 py-4 backdrop-blur md:px-6">
        <div
          className="mx-auto max-w-4xl"
          style={isCompact ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' } : undefined}
        >
          {unsupportedMessage && (
            <div className="mb-3 rounded-2xl border border-[#f7c5be] bg-[#fff6f4] px-4 py-3 text-sm text-[#9a3412]">
              当前 Dify 配置存在未支持字段：{unsupportedMessage}。聊天发送已被阻止。
            </div>
          )}

          <div className="rounded-[28px] border border-[#dde3ef] bg-[#f9fafe] px-3 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            {attachments.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2 px-2">
                {attachments.map((attachment) => {
                  const isImage = IMAGE_EXTENSIONS.has(attachment.extension)
                  return (
                    <div
                      key={attachment.localId}
                      className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs ${
                        attachment.status === 'error'
                          ? 'border-[#f4c7c3] bg-[#fff6f4] text-[#912018]'
                          : 'border-[#dbe1ee] bg-white text-[#475467]'
                      }`}
                    >
                      <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${isImage ? 'bg-[#eef2ff] text-[#4a67f5]' : 'bg-[#fff3e9] text-[#b85f19]'}`}>
                        {isImage ? <PhotoIcon className="h-4 w-4" /> : <DocumentTextIcon className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="max-w-[180px] truncate font-medium">{attachment.name}</div>
                        <div className="text-[11px] text-[#8a93a6]">
                          {attachment.status === 'uploading'
                            ? `上传中 ${attachment.progress}%`
                            : attachment.status === 'error'
                              ? '上传失败'
                              : formatFileSize(attachment.size)}
                        </div>
                      </div>
                      {!isSending && (
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(attachment.localId)}
                          className="rounded-full p-1 text-[#98a2b3] transition hover:bg-[#f5f7fb] hover:text-[#475467]"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex items-end gap-3">
              {fileUploadEnabled && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={attachmentAccept}
                    multiple={attachmentLimit > 1}
                    className="hidden"
                    onChange={(event) => {
                      handleAttachmentChange(event).catch(() => {})
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!localUploadEnabled || isSending || isMultiTurnLocked}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#d5dbea] bg-white text-[#667085] transition hover:border-[#c6d0e3] hover:text-[#344054] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="上传附件"
                  >
                    <PaperClipIcon className="h-5 w-5" />
                  </button>
                </>
              )}

              <textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                disabled={isMultiTurnLocked}
                onFocus={() => {
                  setIsComposerFocused(true)
                  setSidebarOpen(false)
                }}
                onBlur={() => setIsComposerFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleSendMessage().catch(() => {})
                  }
                }}
                rows={1}
                className="max-h-48 min-h-[44px] flex-1 resize-y border-none bg-transparent px-3 py-2 text-sm text-[#111827] outline-none disabled:cursor-not-allowed disabled:text-[#98a2b3]"
                placeholder={isMultiTurnLocked ? '测试版本不支持多轮对话' : '写上这封邮件的主要诉求或期望达成目的'}
              />
              <button
                type="button"
                onClick={() => {
                  handleSendMessage().catch(() => {})
                }}
                disabled={!draft.trim()
                  || isSending
                  || unsupportedVariables.length > 0
                  || isUploadingAttachments
                  || isMultiTurnLocked
                  || (inviteGate.enabled && !inviteGate.activated)
                  || (inviteGate.enabled && typeof inviteGate.remaining === 'number' && inviteGate.remaining <= 0)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#3e63f5] text-white transition hover:bg-[#3557df] disabled:cursor-not-allowed disabled:bg-[#9fb0f8]"
              >
                <PaperAirplaneIcon className="h-5 w-5" />
              </button>
            </div>

            {fileUploadEnabled && (
              <div className="mt-3 px-2 text-xs leading-6 text-[#8a93a6]">
                支持 {availableFileTypesLabel || '附件'}，最多 {attachmentLimit} 个。
                {allowedFileTypes.map((type) => {
                  const limit = getFileSizeLimitMb(type, parameters)
                  return limit ? ` ${FILE_TYPE_LABELS[type]}单文件上限 ${limit} MB。` : ''
                }).join('')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#f5f7fb] text-sm text-[#667085]">
        正在加载 Dify 页面配置…
      </div>
    )
  }

  if (fatalError) {
    return (
      <div className="flex h-full items-center justify-center bg-[#f5f7fb] p-4">
        <div className="w-full max-w-xl rounded-[28px] border border-[#f4c7c3] bg-white px-6 py-6 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
          <div className="text-lg font-semibold text-[#912018]">页面初始化失败</div>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#7a2e20]">{fatalError}</div>
          <button
            type="button"
            onClick={() => {
              bootstrap().catch(() => {})
            }}
            className="mt-5 rounded-2xl bg-[#3e63f5] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#3557df]"
          >
            重新加载
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="h-full min-h-0 bg-[radial-gradient(circle_at_top,#ffffff_0%,#f6f7fb_38%,#f1f3f8_100%)] text-[#111827]"
      style={workspaceViewportStyle}
    >
      <div className="flex h-full min-h-0">
        {!isCompact && sidebar}

        <main className="relative flex-1 min-h-0 overflow-hidden">
          {isCompact && (
            <div className="flex items-center justify-between border-b border-[#e5e7ef] bg-white/90 px-4 py-3 backdrop-blur">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-2xl border border-[#dbe1ee] bg-white p-2 text-[#344054]"
              >
                <Bars3Icon className="h-5 w-5" />
              </button>
              <div className="min-w-0 text-center">
                <div className="truncate text-sm font-semibold text-[#243041]">{APP_INFO.title}</div>
              </div>
              <button
                type="button"
                onClick={handleNewConversation}
                className="rounded-2xl border border-[#dbe1ee] bg-white p-2 text-[#344054]"
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>
          )}

          {workspaceMode === 'setup' ? renderSetupView() : renderChatView()}
        </main>
      </div>

      {isCompact && sidebarOpen && (
        <div className="fixed inset-0 z-40 flex bg-[#111827]/30 backdrop-blur-[2px]">
          <div className="relative h-full w-[86%] max-w-[320px]">
            {sidebar}
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="absolute right-3 top-3 rounded-2xl border border-[#dce1ee] bg-white p-1.5 text-[#344054]"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <button
            type="button"
            aria-label="关闭侧栏"
            onClick={() => setSidebarOpen(false)}
            className="flex-1"
          />
        </div>
      )}

      {renameState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/35 p-4">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="text-lg font-semibold text-[#243041]">重命名会话</div>
            <input
              value={renameState.value}
              onChange={event => setRenameState({ ...renameState, value: event.target.value })}
              className="mt-4 w-full rounded-2xl border border-[#dde3ef] bg-[#f8f9fc] px-4 py-3 text-sm outline-none focus:border-[#4a67f5] focus:bg-white"
              placeholder="输入新的会话名称"
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRenameState(null)}
                className="rounded-2xl border border-[#dde3ef] px-4 py-2.5 text-sm font-medium text-[#475467]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRenameConversation().catch(() => {})
                }}
                className="rounded-2xl bg-[#3e63f5] px-4 py-2.5 text-sm font-semibold text-white"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/35 p-4">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="text-lg font-semibold text-[#243041]">删除会话</div>
            <p className="mt-3 text-sm leading-6 text-[#667085]">
              会话“{deleteTarget.name || '未命名会话'}”会从当前用户列表中删除。这个操作会直接调用 Dify 删除接口，不做本地回退。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-2xl border border-[#dde3ef] px-4 py-2.5 text-sm font-medium text-[#475467]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDeleteConversation().catch(() => {})
                }}
                className="rounded-2xl bg-[#d92d20] px-4 py-2.5 text-sm font-semibold text-white"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {inviteGate.enabled && !inviteGate.activated && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#111827]/45 p-4 backdrop-blur-[3px]">
          <div className="w-full max-w-md rounded-[28px] border border-[#e5e7ef] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef2ff] text-[#4a67f5]">
              <ChatBubbleLeftRightIcon className="h-6 w-6" />
            </div>
            <div className="mt-4 text-xl font-semibold text-[#243041]">请输入邀请码</div>
            <input
              value={inviteGate.code}
              onChange={event => setInviteGate(prev => ({ ...prev, code: event.target.value, error: null }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleActivateInvite().catch(() => {})
                }
              }}
              className="mt-5 w-full rounded-2xl border border-[#dde3ef] bg-[#f8f9fc] px-4 py-3 text-sm outline-none transition focus:border-[#4a67f5] focus:bg-white"
              placeholder="请输入邀请码"
            />
            {inviteGate.error && (
              <div className="mt-3 rounded-2xl border border-[#f7c5be] bg-[#fff6f4] px-4 py-3 text-sm text-[#9a3412]">
                {inviteGate.error}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                handleActivateInvite().catch(() => {})
              }}
              disabled={inviteGate.isSubmitting}
              className="mt-5 w-full rounded-2xl bg-[#3e63f5] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#3557df] disabled:cursor-not-allowed disabled:bg-[#9fb0f8]"
            >
              {inviteGate.isSubmitting ? '正在校验邀请码…' : '确认邀请码'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChatWorkspace
