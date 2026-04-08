import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { APP_ID } from '@/config'

const INVITE_KEY_PREFIX = `invite_quota:${APP_ID}`
const NOT_ACTIVATED_SENTINEL = -1000

export class InviteGateError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'InviteGateError'
    this.status = status
  }
}

type InviteGateStatus = {
  enabled: boolean
  activated: boolean
  remaining: number | null
  quota: number | null
}

type InviteGateConfig = {
  enabled: boolean
  code: string
  quota: number
  redisUrl: string
  redisToken: string
}

const getInviteConfig = (): InviteGateConfig => {
  const enabled = process.env.INVITE_GATE_ENABLED === 'true'
  if (!enabled)
    return { enabled: false, code: '', quota: 0, redisUrl: '', redisToken: '' }

  const code = process.env.INVITE_CODE?.trim()
  if (!code)
    throw new InviteGateError('INVITE_GATE_ENABLED=true 时必须设置 INVITE_CODE。', 500)

  const quotaRaw = process.env.INVITE_QUOTA?.trim()
  if (!quotaRaw)
    throw new InviteGateError('INVITE_GATE_ENABLED=true 时必须设置 INVITE_QUOTA。', 500)

  const quota = Number.parseInt(quotaRaw, 10)
  if (!Number.isFinite(quota) || quota <= 0)
    throw new InviteGateError('INVITE_QUOTA 必须是大于 0 的整数。', 500)

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim() || ''
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim() || ''

  if (!redisUrl || !redisToken) {
    throw new InviteGateError(
      'INVITE_GATE_ENABLED=true 时必须配置 Redis。请提供 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN，或 KV_REST_API_URL + KV_REST_API_TOKEN。',
      500,
    )
  }

  return { enabled, code, quota, redisUrl, redisToken }
}

let redis: Redis | null = null

const getRedis = () => {
  const config = getInviteConfig()
  if (!config.enabled)
    throw new InviteGateError('当前应用未开启邀请码限制。', 400)

  if (!redis) {
    redis = new Redis({
      url: config.redisUrl,
      token: config.redisToken,
    })
  }

  return { redis, config }
}

const buildQuotaKey = (sessionId: string, code: string) => {
  const codeHash = createHash('sha256').update(`${APP_ID}:${code}`).digest('hex').slice(0, 16)
  return `${INVITE_KEY_PREFIX}:${codeHash}:${sessionId}`
}

const safeCompare = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length)
    return false

  return timingSafeEqual(leftBuffer, rightBuffer)
}

const parseRemaining = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value))
    return value

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed))
      return parsed
  }

  return null
}

export const getInviteGateStatus = async (sessionId: string): Promise<InviteGateStatus> => {
  const config = getInviteConfig()
  if (!config.enabled)
    return { enabled: false, activated: false, remaining: null, quota: null }

  const { redis } = getRedis()
  const remaining = parseRemaining(await redis.get(buildQuotaKey(sessionId, config.code)))

  return {
    enabled: true,
    activated: remaining !== null,
    remaining,
    quota: config.quota,
  }
}

export const activateInviteGate = async (sessionId: string, inviteCode: string): Promise<InviteGateStatus> => {
  const { redis, config } = getRedis()
  if (!config.enabled)
    throw new InviteGateError('当前应用未开启邀请码限制。', 400)

  const normalizedInviteCode = inviteCode.trim()
  if (!normalizedInviteCode)
    throw new InviteGateError('请输入邀请码。', 400)

  if (!safeCompare(normalizedInviteCode, config.code))
    throw new InviteGateError('邀请码不正确。', 403)

  const remaining = Number(await redis.eval<number>(
    `
      local current = redis.call("GET", KEYS[1])
      if current then
        return tonumber(current)
      end

      redis.call("SET", KEYS[1], ARGV[1])
      return tonumber(ARGV[1])
    `,
    [buildQuotaKey(sessionId, config.code)],
    [String(config.quota)],
  ))

  return {
    enabled: true,
    activated: true,
    remaining,
    quota: config.quota,
  }
}

export const consumeInviteQuota = async (sessionId: string) => {
  const config = getInviteConfig()
  if (!config.enabled)
    return null

  const { redis } = getRedis()
  const remaining = Number(await redis.eval<number>(
    `
      local current = redis.call("GET", KEYS[1])
      if not current then
        return -1000
      end

      current = tonumber(current)
      if current <= 0 then
        return current
      end

      local next = redis.call("DECR", KEYS[1])
      return tonumber(next)
    `,
    [buildQuotaKey(sessionId, config.code)],
    [],
  ))

  if (remaining === NOT_ACTIVATED_SENTINEL)
    throw new InviteGateError('请先输入邀请码再开始使用。', 403)

  if (remaining < 0)
    throw new InviteGateError('邀请码次数状态异常，请联系管理员检查 Redis 数据。', 500)

  if (remaining === 0)
    return { enabled: true, remaining: 0, quota: config.quota }

  return { enabled: true, remaining, quota: config.quota }
}
