export const EVENT_PROPERTIES = {
  home_view: ['sessionId'],
  template_view: ['templateId'],
  photo_select_start: ['templateId'],
  photo_select_success: ['templateId', 'sizeKb'],
  editor_view: ['templateId'],
  generation_start: ['templateId', 'workId'],
  generation_success: ['templateId', 'durationMs', 'outputKb'],
  generation_fail: ['templateId', 'failureCode'],
  work_save_success: ['workId'],
  work_share_tap: ['workId', 'templateId'],
  create_again_tap: ['workId', 'nextTemplateId'],
} as const

export type AnalyticsEventName = keyof typeof EVENT_PROPERTIES

export interface AnalyticsEvent {
  eventName: AnalyticsEventName
  properties: Record<string, string | number>
}

export type AnalyticsSender = (events: AnalyticsEvent[]) => Promise<unknown>
export type SessionIdProvider = () => Promise<string>

const BATCH_SIZE = 20

function pickProperties(
  eventName: AnalyticsEventName,
  input: Record<string, unknown> = {},
): Record<string, string | number> {
  const allowed = EVENT_PROPERTIES[eventName] as readonly string[]
  const properties: Record<string, string | number> = {}
  for (const key of allowed) {
    const value = input[key]
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
      properties[key] = value
    }
  }
  return properties
}

export function createAnalytics(
  sendBatch: AnalyticsSender,
  getSessionId?: SessionIdProvider,
) {
  const queue: AnalyticsEvent[] = []
  let sessionIdPromise: Promise<string> | undefined
  let flushing: Promise<void> | undefined

  const getAnonymousSessionId = async (): Promise<string | undefined> => {
    if (!getSessionId) return undefined
    sessionIdPromise ??= getSessionId()
    try {
      return await sessionIdPromise
    } catch {
      return undefined
    }
  }

  const flush = (): Promise<void> => {
    if (flushing) return flushing
    const operation = (async () => {
      while (queue.length > 0) {
        const events = queue.splice(0, BATCH_SIZE)
        try {
          await sendBatch(events)
        } catch {
          try {
            await sendBatch(events)
          } catch {
            // Analytics is best-effort; a failed batch must not affect product flows.
          }
        }
      }
    })()
    flushing = operation.finally(() => {
      flushing = undefined
    })
    return flushing
  }

  const track = async (
    eventName: AnalyticsEventName,
    input: Record<string, unknown> = {},
  ): Promise<void> => {
    if (!Object.hasOwn(EVENT_PROPERTIES, eventName)) return
    const properties = pickProperties(eventName, input)
    if (eventName === 'home_view') {
      delete properties.sessionId
      const sessionId = await getAnonymousSessionId()
      if (sessionId) properties.sessionId = sessionId
    }
    queue.push({ eventName, properties })
    if (queue.length >= BATCH_SIZE) void flush()
  }

  return { track, flush }
}
