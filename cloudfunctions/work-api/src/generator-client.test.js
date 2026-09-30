const assert = require('node:assert/strict')
const test = require('node:test')

const { createGeneratorClient } = require('./generator-client')

test('calls the generator through CloudBase callContainer and validates its response', async () => {
  const calls = []
  const input = {
    requestId: 'request-123',
    workId: 'work-12345678',
    templateId: 'pat-head',
    sourceUrl: 'https://temporary.example/source.png',
    editorState: { x: 240, y: 278, scale: 1, speed: 'standard' },
  }
  const { generateWork } = createGeneratorClient({
    serviceName: 'generator',
    token: 'internal-secret',
    callContainerImpl: async (...args) => {
      calls.push(args)
      return {
        requestId: 'cloud-request-123',
        statusCode: 200,
        header: { 'content-type': 'application/json' },
        data: {
          resultFileId: 'cloud://env/result.gif',
          coverFileId: 'cloud://env/cover.jpg',
          subjectFileId: 'cloud://env/subject.png',
          outputBytes: 2048,
        },
      }
    },
  })

  const result = await generateWork(input)

  assert.deepEqual(result, {
    resultFileId: 'cloud://env/result.gif',
    coverFileId: 'cloud://env/cover.jpg',
    subjectFileId: 'cloud://env/subject.png',
    outputBytes: 2048,
  })
  assert.deepEqual(calls, [[
    {
      name: 'generator',
      method: 'POST',
      path: '/v1/generate',
      header: {
        'X-Generator-Token': 'internal-secret',
        'content-type': 'application/json',
      },
      data: input,
    },
    { timeout: 110000 },
  ]])
})

test('returns the validated private cutout ID with generator output IDs', async () => {
  const { generateWork } = createGeneratorClient({
    serviceName: 'generator',
    token: 'internal-secret',
    callContainerImpl: async () => ({
      statusCode: 200,
      data: {
        resultFileId: 'cloud://env/result.gif',
        coverFileId: 'cloud://env/cover.jpg',
        subjectFileId: 'cloud://env/subject.png',
        outputBytes: 2048,
      },
    }),
  })

  const result = await generateWork({ requestId: 'request-123', workId: 'work-12345678' })

  assert.deepEqual(result, {
    resultFileId: 'cloud://env/result.gif',
    coverFileId: 'cloud://env/cover.jpg',
    subjectFileId: 'cloud://env/subject.png',
    outputBytes: 2048,
  })
})

test('rejects a generator response without a subject file ID', async () => {
  const { generateWork } = createGeneratorClient({
    serviceName: 'generator',
    token: 'internal-secret',
    callContainerImpl: async () => ({
      statusCode: 200,
      data: {
        resultFileId: 'cloud://env/result.gif',
        coverFileId: 'cloud://env/cover.jpg',
        outputBytes: 2048,
      },
    }),
  })

  await assert.rejects(
    generateWork({ requestId: 'request-123', workId: 'work-12345678' }),
    (error) => error.code === 'ENCODING_FAILED',
  )
})

test('prepareSubject uses the sibling endpoint and validates private ID and dimensions', async () => {
  const requests = []
  const { prepareSubject } = createGeneratorClient({
    serviceName: 'generator',
    token: 'internal-secret',
    callContainerImpl: async (request) => {
      requests.push(request)
      return {
        statusCode: 200,
        data: {
          subjectFileId: 'cloud://env/uploads/ticket-123456/request-123456/subject.png',
          width: 320,
          height: 240,
        },
      }
    },
  })
  const input = {
    sourceUrl: 'https://temporary.example/source.png',
    subjectObjectPath: 'uploads/ticket-123456/request-123456/subject.png',
  }

  const result = await prepareSubject(input)

  assert.deepEqual(result, {
    subjectFileId: 'cloud://env/uploads/ticket-123456/request-123456/subject.png',
    width: 320,
    height: 240,
  })
  assert.equal(requests[0].name, 'generator')
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].path, '/v1/prepare-subject')
  assert.deepEqual(requests[0].data, input)

  const invalid = createGeneratorClient({
    serviceName: 'generator',
    token: 'internal-secret',
    callContainerImpl: async () => ({
      statusCode: 200,
      data: { subjectFileId: 'https://public.example/subject.png', width: 0, height: 240 },
    }),
  })
  await assert.rejects(invalid.prepareSubject(input), (error) => error.code === 'ENCODING_FAILED')
})

test('logs only safe upstream metadata when callContainer rejects', async () => {
  const diagnostics = []
  const upstreamError = Object.assign(
    new Error('request failed with private image URL and bearer secret'),
    { code: 403, statusCode: 403, requestId: 'cloud-request-403' },
  )
  const { prepareSubject } = createGeneratorClient({
    serviceName: 'generator',
    token: 'internal-secret',
    logger: { error: (event) => diagnostics.push(event) },
    callContainerImpl: async () => { throw upstreamError },
  })

  await assert.rejects(
    prepareSubject({ sourceUrl: 'https://temporary.example/private?token=private' }),
    (error) => error.code === 'NETWORK_ERROR' && error.diagnosticCode === '403',
  )

  assert.deepEqual(diagnostics, [{
    action: 'generator-call-failed',
    path: 'prepare-subject',
    upstreamCode: '403',
    statusCode: 403,
    requestId: 'cloud-request-403',
  }])
  assert.equal(JSON.stringify(diagnostics).includes('private'), false)
})

test('reports only a safe HTTP status when the generator rejects preparation', async () => {
  const { prepareSubject } = createGeneratorClient({
    serviceName: 'generator',
    token: 'internal-secret',
    callContainerImpl: async () => ({
      statusCode: 503,
      data: { error: { code: 'secret bearer token=private' } },
    }),
  })

  await assert.rejects(
    prepareSubject({ sourceUrl: 'https://temporary.example/private' }),
    (error) => error.code === 'NETWORK_ERROR' && error.diagnosticCode === 'HTTP_503',
  )
})

test('reports a missing generator configuration without exposing its token', async () => {
  const { prepareSubject } = createGeneratorClient({
    serviceName: 'generator',
    token: undefined,
    callContainerImpl: async () => { throw new Error('should not be called') },
  })

  await assert.rejects(
    prepareSubject({ sourceUrl: 'https://temporary.example/private' }),
    (error) => error.code === 'NETWORK_ERROR' && error.diagnosticCode === 'CONFIG_MISSING',
  )
})

test('reports an invalid container response without echoing its body', async () => {
  const { prepareSubject } = createGeneratorClient({
    serviceName: 'generator',
    token: 'internal-secret',
    callContainerImpl: async () => ({ statusCode: 200, data: null }),
  })

  await assert.rejects(
    prepareSubject({ sourceUrl: 'https://temporary.example/private' }),
    (error) => error.code === 'NETWORK_ERROR' && error.diagnosticCode === 'INVALID_RESPONSE',
  )
})

test('404 returns a stable network error without extra diagnostic requests', async () => {
  const paths = []
  const { prepareSubject } = createGeneratorClient({
    serviceName: 'generator',
    token: 'internal-secret',
    callContainerImpl: async (request) => {
      paths.push(request.path)
      return { statusCode: 404, data: { detail: 'Not Found' } }
    },
  })

  await assert.rejects(
    prepareSubject({
      sourceUrl: 'https://temporary.example/private',
      subjectObjectPath: 'uploads/ticket-123/codex_diag_12345678/subject.png',
    }),
    (error) => error.code === 'NETWORK_ERROR' &&
      error.diagnosticCode === 'HTTP_404',
  )
  assert.deepEqual(paths, ['/v1/prepare-subject'])
})
