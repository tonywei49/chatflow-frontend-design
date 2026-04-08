import type { Locale } from '@/i18n'

export type AppInfo = {
  title: string
  description: string
  default_language: Locale
  copyright?: string
  privacy_policy?: string
}

export type PromptVariable = {
  key: string
  name: string
  type: string
  default?: string | number
  required?: boolean
  options?: string[]
  max_length?: number
}

export type UnsupportedPromptVariable = {
  key: string
  name: string
  type: string
}

export type PromptConfig = {
  prompt_template: string
  prompt_variables: PromptVariable[]
}

export type TextTypeFormItem = {
  label: string
  variable: string
  required: boolean
  max_length: number
}

export type SelectTypeFormItem = {
  label: string
  variable: string
  required: boolean
  options: string[]
}
/**
 * User Input Form Item
 */
export type UserInputFormItem = {
  'text-input': TextTypeFormItem
} | {
  'select': SelectTypeFormItem
}

export type ConversationItem = {
  id: string
  name: string
  inputs?: Record<string, string | number>
  status?: string
  introduction?: string
  created_at: number
  updated_at: number
}

export type ConversationListResponse = {
  data: ConversationItem[]
  has_more: boolean
  limit: number
}

export type FileUploadCategory = 'document' | 'image' | 'audio' | 'video' | 'custom'

export type FileUploadOption = {
  enabled: boolean
  number_limits?: number
  transfer_methods?: TransferMethod[]
}

export type FileUploadSystemConfig = {
  file_size_limit?: number
  image_file_size_limit?: number
  audio_file_size_limit?: number
  video_file_size_limit?: number
  workflow_file_upload_limit?: number
  batch_count_limit?: number
  file_upload_limit?: number
  image_file_batch_limit?: number
  single_chunk_attachment_limit?: number
  attachment_image_file_size_limit?: number
}

export type FileUploadConfig = {
  enabled?: boolean
  allowed_file_types?: FileUploadCategory[]
  allowed_file_extensions?: string[]
  allowed_file_upload_methods?: TransferMethod[]
  number_limits?: number
  fileUploadConfig?: FileUploadSystemConfig
  document?: FileUploadOption
  image?: FileUploadOption
  audio?: FileUploadOption
  video?: FileUploadOption
  custom?: FileUploadOption
}

export type AppParametersResponse = {
  opening_statement?: string
  user_input_form?: UserInputFormItem[]
  suggested_questions?: string[]
  file_upload?: FileUploadConfig
  system_parameters?: FileUploadSystemConfig
}

export type UploadedFile = {
  id: string
  name: string
  size: number
  extension: string
  mime_type: string
  created_by: number | string
  created_at: number
}

export type MessageFile = {
  id: string
  type: string
  url: string
  belongs_to: 'user' | 'assistant'
}

export type ConversationMessage = {
  id: string
  conversation_id: string
  inputs?: Record<string, string | number>
  query: string
  answer: string
  message_files?: MessageFile[]
  created_at: number
  feedback?: {
    rating?: MessageRating
  }
}

export type ConversationMessageListResponse = {
  data: ConversationMessage[]
  has_more: boolean
  limit: number
}

export const MessageRatings = ['like', 'dislike', null] as const
export type MessageRating = typeof MessageRatings[number]

export type Feedbacktype = {
  rating: MessageRating
  content?: string | null
}

export enum Resolution {
  low = 'low',
  high = 'high',
}

export enum TransferMethod {
  all = 'all',
  local_file = 'local_file',
  remote_url = 'remote_url',
}

export type VisionSettings = {
  enabled: boolean
  number_limits: number
  detail: Resolution
  transfer_methods: TransferMethod[]
  image_file_size_limit?: number | string
}

export type ImageFile = {
  type: TransferMethod
  _id: string
  fileId: string
  file?: File
  progress: number
  url: string
  base64Url?: string
  deleted?: boolean
}

export type VisionFile = {
  id?: string
  type: string
  transfer_method: TransferMethod
  url: string
  upload_file_id: string
}

export type ChatAttachment = {
  localId: string
  name: string
  size: number
  extension: string
  mimeType: string
  fileType: FileUploadCategory
  progress: number
  status: 'uploading' | 'uploaded' | 'error'
  uploadFileId?: string
  errorMessage?: string
}

export type InviteGateStatus = {
  enabled: boolean
  activated: boolean
  remaining: number | null
  quota: number | null
}

export enum BlockEnum {
  Start = 'start',
  End = 'end',
  Answer = 'answer',
  LLM = 'llm',
  KnowledgeRetrieval = 'knowledge-retrieval',
  QuestionClassifier = 'question-classifier',
  IfElse = 'if-else',
  Code = 'code',
  TemplateTransform = 'template-transform',
  HttpRequest = 'http-request',
  VariableAssigner = 'variable-assigner',
  Tool = 'tool',
}

export type NodeTracing = {
  id: string
  index: number
  predecessor_node_id: string
  node_id: string
  node_type: BlockEnum
  title: string
  inputs: any
  process_data: any
  outputs?: any
  status: string
  error?: string
  elapsed_time: number
  execution_metadata: {
    total_tokens: number
    total_price: number
    currency: string
  }
  created_at: number
  created_by: {
    id: string
    name: string
    email: string
  }
  finished_at: number
  extras?: any
  expand?: boolean // for UI
}

export enum NodeRunningStatus {
  NotStart = 'not-start',
  Waiting = 'waiting',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
}

export enum WorkflowRunningStatus {
  Waiting = 'waiting',
  Running = 'running',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Stopped = 'stopped',
}

export type WorkflowProcess = {
  status: WorkflowRunningStatus
  tracing: NodeTracing[]
  expand?: boolean // for UI
}

export enum CodeLanguage {
  python3 = 'python3',
  javascript = 'javascript',
  json = 'json',
}
