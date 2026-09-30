const test = require('node:test')
const assert = require('node:assert/strict')

const cloudbaseConfig = require('../../cloudbaserc.json')

test('runs cleanup hourly so expiry deletion does not wait until the next day', () => {
  const cleanupFunction = cloudbaseConfig.functions.find(({ name }) => name === 'cleanup-expired')
  const trigger = cleanupFunction?.triggers?.find(({ name }) => name === 'hourly-cleanup')

  assert.ok(trigger, 'cleanup timer must be configured')
  assert.deepEqual(trigger.config.split(' '), ['0', '0', '*', '*', '*', '*', '*'])
})

test('deploys the work API with a compatible Node runtime and installed dependencies', () => {
  const workApi = cloudbaseConfig.functions.find(({ name }) => name === 'work-api')

  assert.ok(workApi, 'work-api must be part of the CloudBase deployment')
  assert.equal(workApi.runtime, 'Nodejs20.19')
  assert.equal(workApi.handler, 'index.main')
  assert.equal(workApi.installDependency, true)
  assert.equal(workApi.timeout, 120)
})
