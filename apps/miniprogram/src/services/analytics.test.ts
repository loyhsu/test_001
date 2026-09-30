import { describe, expect, it } from 'vitest'

import { createAnalytics, type AnalyticsEvent } from './analytics'

describe('analytics allowlist and delivery', () => {
  it('drops properties that are not declared for the event', async () => {
    const batches: AnalyticsEvent[][] = []
    const analytics = createAnalytics(async (events) => { batches.push(events) })

    await analytics.track('generation_success', {
      templateId: 'pat-head',
      durationMs: 4200,
      outputKb: 830,
      originalImageUrl: 'private-value',
    })
    await analytics.flush()

    expect(batches).toEqual([[
      {
        eventName: 'generation_success',
        properties: { templateId: 'pat-head', durationMs: 4200, outputKb: 830 },
      },
    ]])
  })

  it('adds only a generated anonymous session ID to the home event', async () => {
    const batches: AnalyticsEvent[][] = []
    const analytics = createAnalytics(
      async (events) => { batches.push(events) },
      async () => 'session-12345678',
    )

    await analytics.track('home_view')
    await analytics.flush()

    expect(batches[0][0]).toEqual({
      eventName: 'home_view',
      properties: { sessionId: 'session-12345678' },
    })
  })

  it('never accepts a caller-supplied session ID as anonymous identity', async () => {
    const batches: AnalyticsEvent[][] = []
    const analytics = createAnalytics(async (events) => { batches.push(events) })

    await analytics.track('home_view', { sessionId: 'raw-openid-or-user-id' })
    await analytics.flush()

    expect(batches[0][0]).toEqual({ eventName: 'home_view', properties: {} })
  })

  it('never sends more than 20 events in one batch', async () => {
    const batches: AnalyticsEvent[][] = []
    const analytics = createAnalytics(async (events) => { batches.push(events) })

    for (let index = 0; index < 21; index += 1) {
      await analytics.track('template_view', { templateId: 'pat-head' })
    }
    await analytics.flush()

    expect(batches.map((batch) => batch.length)).toEqual([20, 1])
  })

  it('retries a failed batch once and does not wait on delivery while tracking', async () => {
    let attempts = 0
    const analytics = createAnalytics(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary network failure')
    })

    for (let index = 0; index < 20; index += 1) {
      await analytics.track('template_view', { templateId: 'pat-head' })
    }
    await analytics.flush()

    expect(attempts).toBe(2)
  })
})
