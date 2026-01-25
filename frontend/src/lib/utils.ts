import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const API_BASE = '/api'

interface ApiResponse<T> {
  code: number
  data: T
  message: string
}

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  if (options?.body) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  })
  const body: ApiResponse<T> = await res.json().catch(() => ({ code: res.status, data: null as T, message: `HTTP ${res.status}` }))
  if (body.code !== 0) {
    throw new Error(body.message || `HTTP ${res.status}`)
  }
  return body.data
}

export interface AIModel {
  id: number
  name: string
  service_id: number
  model: string
  is_default: boolean
}

export interface AIService {
  id: number
  name: string
  base_url: string
  api_key: string
  models: AIModel[]
}

export interface NotifyChannel {
  id: number
  name: string
  type: string
  config: Record<string, string>
  enabled: boolean
  is_default: boolean
}

export interface DataSource {
  id: number
  name: string
  type: string       // news / chart / quote
  provider: string   // cls / eastmoney / tencent
  config: Record<string, unknown>
  enabled: boolean
  priority: number
}
