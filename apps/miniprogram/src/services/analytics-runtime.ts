import { createRequestId } from '../platform/request-id'
import { createAnalytics } from './analytics'
import { workApi } from './work-api'

const analytics = createAnalytics(
  (events) => workApi.trackEvents(events),
  createRequestId,
)

export const track = analytics.track
export const flushAnalytics = analytics.flush
