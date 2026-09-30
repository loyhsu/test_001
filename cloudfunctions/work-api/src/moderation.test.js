const assert = require('node:assert/strict')
const test = require('node:test')

const { createModerator } = require('./moderation')

function fakeSharp() {
  return () => ({
    metadata: async () => ({ format: 'png', width: 640, height: 640 }),
    rotate() { return this },
    resize() { return this },
    jpeg() { return this },
    toBuffer: async () => Buffer.from('moderation-image'),
  })
}

test('logs only the safe upstream moderation code when WeChat OpenAPI fails', async () => {
  const events = []
  const logger = { error: (event) => events.push(event) }
  const cloud = {
    openapi: {
      security: {
        imgSecCheck: async () => {
          const error = new Error('private upstream message')
          error.errCode = -604101
          error.errMsg = 'private upstream message'
          error.request = { headers: { authorization: 'secret' } }
          throw error
        },
      },
    },
  }
  const moderate = createModerator(cloud, fakeSharp(), logger)

  await assert.rejects(
    moderate(Buffer.from('source-image'), 'png'),
    (error) => error.code === 'NETWORK_ERROR' &&
      error.diagnosticCode === '-604101' &&
      !JSON.stringify(error).includes('private upstream message'),
  )

  assert.deepEqual(events, [{ action: 'moderation-openapi-failed', code: '-604101' }])
  assert.equal(JSON.stringify(events).includes('private upstream message'), false)
  assert.equal(JSON.stringify(events).includes('secret'), false)
})

test('redacts unexpected upstream codes rather than logging arbitrary values', async () => {
  const events = []
  const logger = { error: (event) => events.push(event) }
  const cloud = {
    openapi: {
      security: {
        imgSecCheck: async () => {
          const error = new Error('private upstream message')
          error.errCode = 'token=private-value'
          throw error
        },
      },
    },
  }
  const moderate = createModerator(cloud, fakeSharp(), logger)

  await assert.rejects(
    moderate(Buffer.from('source-image'), 'png'),
    (error) => error.diagnosticCode === 'UNKNOWN',
  )

  assert.deepEqual(events, [{ action: 'moderation-openapi-failed', code: 'UNKNOWN' }])
})
