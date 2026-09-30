import Taro from '@tarojs/taro'

import type { FailureCode, GenerateWorkInput, Work } from '../domain/contracts'
import type { AnalyticsEvent } from './analytics'

export interface CreateUploadTicketInput {
  requestId: string
  imageType: 'jpg' | 'jpeg' | 'png'
}

export interface UploadTicket {
  uploadTicketId: string
  cloudPath: string
  expiresAt: string
}

export interface PrepareSubjectInput {
  requestId: string
  uploadTicketId: string
  sourceFileId: string
}

export interface PreparedSubjectResult {
  subjectUrl: string
  width: number
  height: number
  expiresAt: string
}

export interface TrackEventInput {
  eventName:
    | 'home_view'
    | 'template_view'
    | 'photo_select_start'
    | 'photo_select_success'
    | 'editor_view'
    | 'generation_start'
    | 'generation_success'
    | 'generation_fail'
    | 'work_save_success'
    | 'work_share_tap'
    | 'create_again_tap'
  properties?: Record<string, string | number>
}

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string } }

export class WorkApiError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'WorkApiError'
  }
}

async function call<T>(action: string, payload: object = {}): Promise<T> {
  let response: Awaited<ReturnType<typeof Taro.cloud.callFunction>>
  try {
    response = await Taro.cloud.callFunction({
      name: 'work-api',
      data: { action, payload },
    })
  } catch {
    throw new WorkApiError('NETWORK_ERROR')
  }

  const result = response.result as ApiResult<T> | undefined
  if (!result || typeof result !== 'object') throw new WorkApiError('NETWORK_ERROR')
  if (!result.ok) throw new WorkApiError(result.error?.code || 'NETWORK_ERROR')
  return result.data
}

export const workApi = {
  createUploadTicket(input: CreateUploadTicketInput): Promise<UploadTicket> {
    return call('createUploadTicket', input)
  },

  prepareSubject(input: PrepareSubjectInput): Promise<PreparedSubjectResult> {
    return call('prepareSubject', input)
  },

  createWork(input: GenerateWorkInput): Promise<Work> {
    return call('createWork', input)
  },

  getWork(workId: string): Promise<Work> {
    return call('getWork', { workId })
  },

  listWorks(): Promise<Work[]> {
    return call('listWorks')
  },

  deleteWork(workId: string): Promise<{ deleted: true }> {
    return call('deleteWork', { workId })
  },

  trackEvent(input: TrackEventInput): Promise<{ accepted: true }> {
    return call('trackEvent', input)
  },

  trackEvents(events: AnalyticsEvent[]): Promise<{ accepted: number }> {
    return call('trackEvents', { events })
  },
}

export type WorkApiFailure = FailureCode | 'UNAUTHENTICATED' | 'INVALID_INPUT' | 'NOT_FOUND'
