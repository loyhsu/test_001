const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

test('uses the trusted WeChat context environment for CloudBase container calls', async () => {
  let cloudbaseOptions
  const cloud = {
    init() {},
    database: () => ({}),
    logger: () => ({ error() {} }),
    getWXContext: () => ({ OPENID: 'trusted-user', ENV: 'cloud1-test' }),
  }
  const cloudbaseSdk = {
    SYMBOL_CURRENT_ENV: Symbol.for('SYMBOL_CURRENT_ENV'),
    init(options) {
      cloudbaseOptions = options
      return { callContainer() {} }
    },
  }
  const module = { exports: {} }
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const dependencies = {
    'wx-server-sdk': cloud,
    '@cloudbase/node-sdk': cloudbaseSdk,
    sharp: () => ({}),
    './src/generator-client': { createGeneratorClient: () => ({ generateWork() {}, prepareSubject() {} }) },
    './src/moderation': { createModerator: () => () => {} },
    './src/repository': { createRepository: () => ({}) },
    './src/router': { createRouter: () => ({ dispatch: () => ({ ok: true }) }) },
  }
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) => dependencies[name],
    process: { env: {} },
  })

  await module.exports.main({}, { requestId: 'test-request' })

  assert.equal(cloudbaseOptions.env, 'cloud1-test')
  assert.equal(cloudbaseOptions.context.requestId, 'test-request')
})
