const assert = require('node:assert/strict')
const test = require('node:test')

const { createRouter, workIdFor } = require('./router')
const { ServiceError } = require('./contracts')

const OPENID = 'trusted-openid'
const NOW = new Date('2026-09-24T04:00:00.000Z')
const EDITOR_STATE = { x: 240, y: 278, scale: 1, speed: 'standard', backgroundId: 'template' }
const UPLOAD_TICKET_ID = 'b1000000-0000-4000-8000-000000000001'
const REQUEST_ID = 'request-123'

function makeUploadTicket(overrides = {}) {
  return {
    id: UPLOAD_TICKET_ID,
    openid: OPENID,
    requestId: REQUEST_ID,
    imageType: 'jpg',
    cloudPath: `uploads/${UPLOAD_TICKET_ID}/${REQUEST_ID}/source.jpg`,
    status: 'issued',
    createdAt: '2026-09-24T03:50:00.000Z',
    expiresAt: '2026-09-24T04:15:00.000Z',
    ...overrides,
  }
}

function harness({ records = [], tickets = [], generated, prepareResult, failTicketUpdate = false, failDownloadSource, failModerate, logger } = {}) {
  const works = new Map(records.map((work) => [work.id, { ...work }]))
  const uploadTickets = new Map(tickets.map((ticket) => [ticket.id, { ...ticket }]))
  const calls = {
    generate: [],
    prepareSubject: [],
    moderate: 0,
    downloadSource: 0,
    temporaryUrls: [],
    deletedFiles: [],
    events: [],
    order: [],
  }
  const repository = {
    async getWork(id) {
      return works.get(id) ?? null
    },
    async getOwnedWork(id, openid) {
      const work = works.get(id)
      return work?.openid === openid && !work.deletedAt ? work : null
    },
    async getUploadTicket(id) {
      return uploadTickets.get(id) ?? null
    },
    async updateUploadTicket(id, patch) {
      calls.order.push('updateUploadTicket')
      if (failTicketUpdate) throw new Error('ticket update failed')
      const ticket = { ...uploadTickets.get(id), ...patch }
      uploadTickets.set(id, ticket)
      return ticket
    },
    async createProcessingWork(work, uploadTicketId) {
      works.set(work.id, { ...work })
      if (uploadTicketId) {
        uploadTickets.set(uploadTicketId, {
          ...uploadTickets.get(uploadTicketId),
          status: 'consumed',
          workId: work.id,
          consumedAt: work.createdAt,
        })
      }
      return { created: true, work: works.get(work.id) }
    },
    async updateWork(id, patch) {
      const updated = { ...works.get(id), ...patch }
      works.set(id, updated)
      return updated
    },
    async listOwnedWorks() {
      return [...works.values()].filter((work) => !work.deletedAt)
    },
    async deleteWork(id, patch) {
      works.set(id, { ...works.get(id), ...patch })
    },
    async addEvent(event) {
      calls.events.push(event)
    },
    async addEvents(events) {
      calls.events.push(...events)
    },
  }
  const router = createRouter({
    now: () => new Date(NOW),
    createId: () => 'b1000000-0000-4000-8000-000000000001',
    repository,
    getTemporaryFileUrls: async (ids) => {
      calls.temporaryUrls.push([...ids])
      calls.order.push('temporaryUrls')
      return new Map(ids.map((id) => [id, `https://temporary.example/${encodeURIComponent(id)}`]))
    },
    downloadSource: async () => {
      calls.downloadSource += 1
      calls.order.push('downloadSource')
      if (failDownloadSource) throw failDownloadSource
      return Buffer.from('image')
    },
    moderate: async () => {
      calls.moderate += 1
      calls.order.push('moderate')
      if (failModerate) throw failModerate
    },
    prepareSubject: async (input) => {
      calls.prepareSubject.push(input)
      calls.order.push('prepareSubject')
      return prepareResult ?? {
        subjectFileId: `cloud://env/${input.subjectObjectPath}`,
        width: 320,
        height: 240,
      }
    },
    generate: async (input) => {
      calls.generate.push(input)
      return generated ?? {
        resultFileId: 'cloud://env/result.gif',
        coverFileId: 'cloud://env/cover.jpg',
        subjectFileId: 'cloud://env/subject.png',
        outputBytes: 2048,
      }
    },
    deleteFiles: async (ids) => { calls.deletedFiles.push([...ids]) },
    logger,
  })
  return { router, works, uploadTickets, calls }
}

const reusableWork = (overrides = {}) => ({
  id: 'source-work-12345678',
  openid: OPENID,
  status: 'ready',
  templateId: 'pat-head',
  sourceFileId: 'cloud://env/uploads/source.png',
  sourceExpiresAt: '2026-09-25T03:00:00.000Z',
  subjectFileId: 'cloud://env/works/source/subject.png',
  subjectExpiresAt: '2026-09-25T03:00:00.000Z',
  resultFileId: 'cloud://env/works/source/result.gif',
  coverFileId: 'cloud://env/works/source/cover.jpg',
  editorState: EDITOR_STATE,
  createdAt: '2026-09-24T03:00:00.000Z',
  expiresAt: '2026-10-24T03:00:00.000Z',
  ...overrides,
})

test('reuses an owned, unexpired subject cutout without exposing its file ID to the client', async () => {
  const parent = reusableWork()
  const { router, works, calls } = harness({ records: [parent] })
  const response = await router.dispatch('createWork', {
    requestId: 'request-new-123',
    templateId: 'shake-head',
    sourceWorkId: parent.id,
    editorState: EDITOR_STATE,
  }, OPENID)

  assert.equal(response.ok, true)
  assert.equal(calls.moderate, 0)
  assert.deepEqual(calls.generate[0], {
    requestId: 'request-new-123',
    workId: workIdFor(OPENID, 'request-new-123'),
    templateId: 'shake-head',
    subjectUrl: `https://temporary.example/${encodeURIComponent(parent.subjectFileId)}`,
    reusedSubjectFileId: parent.subjectFileId,
    editorState: EDITOR_STATE,
  })
  assert.equal(works.get(response.data.id).subjectFileId, parent.subjectFileId)
  assert.equal(works.get(response.data.id).subjectExpiresAt, parent.subjectExpiresAt)
  assert.equal('subjectFileId' in response.data, false)
  assert.equal('sourceFileId' in response.data, false)
})

test('rejects a subject reuse request when the previous work belongs to another user', async () => {
  const parent = reusableWork({ openid: 'somebody-else' })
  const { router, calls } = harness({ records: [parent] })
  const response = await router.dispatch('createWork', {
    requestId: 'request-new-456',
    templateId: 'shake-head',
    sourceWorkId: parent.id,
    editorState: EDITOR_STATE,
  }, OPENID)

  assert.deepEqual(response, { ok: false, error: { code: 'NOT_FOUND' } })
  assert.equal(calls.generate.length, 0)
})

test('rejects subject reuse after the 24-hour cutout expiry', async () => {
  const parent = reusableWork({
    sourceExpiresAt: '2026-09-24T03:59:00.000Z',
    subjectExpiresAt: '2026-09-24T03:59:00.000Z',
  })
  const { router, calls } = harness({ records: [parent] })
  const response = await router.dispatch('createWork', {
    requestId: 'request-new-789',
    templateId: 'shake-head',
    sourceWorkId: parent.id,
    editorState: EDITOR_STATE,
  }, OPENID)

  assert.deepEqual(response, { ok: false, error: { code: 'SUBJECT_EXPIRED' } })
  assert.equal(calls.generate.length, 0)
})

test('retries a failed work from its private source and persists the new cutout ID', async () => {
  const requestId = 'request-123'
  const failedWork = reusableWork({
    id: workIdFor(OPENID, requestId),
    status: 'failed',
    failureCode: 'NETWORK_ERROR',
    subjectFileId: undefined,
    subjectExpiresAt: undefined,
  })
  const { router, works, calls } = harness({ records: [failedWork] })
  const response = await router.dispatch('createWork', {
    requestId,
    templateId: failedWork.templateId,
    sourceFileId: failedWork.sourceFileId,
    uploadTicketId: 'b1000000-0000-4000-8000-000000000001',
    editorState: EDITOR_STATE,
  }, OPENID)

  assert.equal(response.ok, true)
  assert.equal(calls.generate.length, 1)
  assert.equal(calls.generate[0].sourceUrl, `https://temporary.example/${encodeURIComponent(failedWork.sourceFileId)}`)
  assert.equal(calls.generate[0].subjectUrl, undefined)
  assert.equal(works.get(failedWork.id).status, 'ready')
  assert.equal(works.get(failedWork.id).subjectFileId, 'cloud://env/subject.png')
  assert.equal(works.get(failedWork.id).subjectExpiresAt, failedWork.sourceExpiresAt)
  assert.equal(response.data.outputKb, 2)
})

test('lists expired works without requesting temporary cover or result URLs', async () => {
  const expired = reusableWork({
    expiresAt: '2026-09-24T03:59:00.000Z',
    resultFileId: 'cloud://env/works/expired/result.gif',
    coverFileId: 'cloud://env/works/expired/cover.jpg',
  })
  const { router, calls } = harness({ records: [expired] })

  const response = await router.dispatch('listWorks', {}, OPENID)

  assert.equal(response.ok, true)
  assert.equal(response.data[0].status, 'expired')
  assert.equal('resultUrl' in response.data[0], false)
  assert.equal('coverUrl' in response.data[0], false)
  assert.deepEqual(calls.temporaryUrls, [[]])
})

test('deletes generated files and hides a tombstone while retaining source assets for expiry cleanup', async () => {
  const work = reusableWork()
  const { router, works, calls } = harness({ records: [work] })

  const response = await router.dispatch('deleteWork', { workId: work.id }, OPENID)

  assert.deepEqual(response, { ok: true, data: { deleted: true } })
  assert.equal(works.get(work.id).deletedAt, NOW.toISOString())
  assert.equal(works.get(work.id).expiresAt, NOW.toISOString())
  assert.equal(works.get(work.id).sourceFileId, work.sourceFileId)
  assert.equal(works.get(work.id).subjectFileId, work.subjectFileId)
  assert.equal(works.get(work.id).resultFileId, null)
  assert.equal(works.get(work.id).coverFileId, null)
  assert.equal(works.get(work.id).openid, null)
  assert.equal(works.get(work.id).templateId, null)
  assert.deepEqual(calls.deletedFiles, [[work.resultFileId, work.coverFileId]])

  assert.deepEqual(await router.dispatch('getWork', { workId: work.id }, OPENID), {
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
  const list = await router.dispatch('listWorks', {}, OPENID)
  assert.deepEqual(list, { ok: true, data: [] })
})

test('stores only allowlisted analytics fields and hashes the trusted user identity', async () => {
  const { router, calls } = harness()

  const response = await router.dispatch('trackEvents', {
    events: [
      {
        eventName: 'generation_success',
        properties: {
          templateId: 'pat-head',
          durationMs: 4200,
          outputKb: 830,
          originalImageUrl: 'private-value',
          openid: OPENID,
        },
      },
    ],
  }, OPENID)

  const { createHash } = require('node:crypto')
  assert.deepEqual(response, { ok: true, data: { accepted: 1 } })
  assert.deepEqual(calls.events[0].properties, {
    templateId: 'pat-head',
    durationMs: 4200,
    outputKb: 830,
  })
  assert.equal(calls.events[0].openidHash, createHash('sha256').update(OPENID).digest('hex'))
  assert.equal('openid' in calls.events[0], false)
})

test('rejects analytics batches larger than 20 without partial writes', async () => {
  const { router, calls } = harness()
  const events = Array.from({ length: 21 }, () => ({
    eventName: 'template_view',
    properties: { templateId: 'pat-head' },
  }))

  const response = await router.dispatch('trackEvents', { events }, OPENID)

  assert.deepEqual(response, { ok: false, error: { code: 'INVALID_INPUT' } })
  assert.equal(calls.events.length, 0)
})

test('prepareSubject moderates before matting and returns only a temporary URL', async () => {
  const ticket = makeUploadTicket()
  const { router, uploadTickets, calls } = harness({ tickets: [ticket] })

  const response = await router.dispatch('prepareSubject', {
    requestId: ticket.requestId,
    uploadTicketId: ticket.id,
    sourceFileId: `cloud://env/${ticket.cloudPath}`,
  }, OPENID)

  assert.equal(response.ok, true)
  assert.deepEqual(response.data, {
    subjectUrl: `https://temporary.example/${encodeURIComponent(`cloud://env/uploads/${ticket.id}/${ticket.requestId}/subject.png`)}`,
    width: 320,
    height: 240,
    expiresAt: '2026-09-25T04:00:00.000Z',
  })
  assert.equal('subjectFileId' in response.data, false)
  assert.ok(calls.order.indexOf('moderate') < calls.order.indexOf('prepareSubject'))
  assert.equal(calls.moderate, 1)
  assert.equal(calls.prepareSubject[0].subjectObjectPath, `uploads/${ticket.id}/${ticket.requestId}/subject.png`)
  assert.equal(uploadTickets.get(ticket.id).subjectFileId, `cloud://env/uploads/${ticket.id}/${ticket.requestId}/subject.png`)
  assert.equal(uploadTickets.get(ticket.id).expiresAt, response.data.expiresAt)
})

test('photo request returns only the stable public error, regardless of request prefix', async () => {
  const ticket = makeUploadTicket({ requestId: 'codex_diag_12345678' })
  const failModerate = Object.assign(new ServiceError('NETWORK_ERROR'), {
    diagnosticCode: '-604101',
  })
  const { router } = harness({ tickets: [ticket], failModerate })

  const response = await router.dispatch('prepareSubject', {
    requestId: ticket.requestId,
    uploadTicketId: ticket.id,
    sourceFileId: `cloud://env/${ticket.cloudPath}`,
  }, OPENID)

  assert.deepEqual(response, {
    ok: false,
    error: { code: 'NETWORK_ERROR' },
  })
})

test('createWork rejects unknown background IDs before accessing an upload ticket', async () => {
  const { router } = harness()
  const invalid = await router.dispatch('createWork', {
    requestId: 'request-background-123',
    uploadTicketId: UPLOAD_TICKET_ID,
    sourceFileId: 'cloud://env/uploads/test/source.jpg',
    templateId: 'pat-head',
    editorState: { ...EDITOR_STATE, backgroundId: 'https://custom.example/bg.png' },
  }, OPENID)

  assert.deepEqual(invalid, { ok: false, error: { code: 'INVALID_INPUT' } })
})

test('prepareSubject rejects foreign and expired tickets before download or matting', async () => {
  const cases = [
    makeUploadTicket({ openid: 'somebody-else' }),
    makeUploadTicket({ expiresAt: '2026-09-24T03:59:00.000Z' }),
  ]

  for (const ticket of cases) {
    const { router, calls } = harness({ tickets: [ticket] })
    const response = await router.dispatch('prepareSubject', {
      requestId: ticket.requestId,
      uploadTicketId: ticket.id,
      sourceFileId: `cloud://env/${ticket.cloudPath}`,
    }, OPENID)

    assert.deepEqual(response, { ok: false, error: { code: 'UPLOAD_TICKET_INVALID' } })
    assert.equal(calls.downloadSource, 0)
    assert.equal(calls.prepareSubject.length, 0)
  }
})

test('prepareSubject retry refreshes the stored cutout URL without rematting', async () => {
  const subjectFileId = `cloud://env/uploads/${UPLOAD_TICKET_ID}/${REQUEST_ID}/subject.png`
  const ticket = makeUploadTicket({
    expiresAt: '2026-09-25T04:00:00.000Z',
    sourceExpiresAt: '2026-09-25T04:00:00.000Z',
    subjectFileId,
    subjectWidth: 300,
    subjectHeight: 220,
    subjectExpiresAt: '2026-09-25T04:00:00.000Z',
  })
  const { router, calls } = harness({ tickets: [ticket] })

  const response = await router.dispatch('prepareSubject', {
    requestId: ticket.requestId,
    uploadTicketId: ticket.id,
    sourceFileId: `cloud://env/${ticket.cloudPath}`,
  }, OPENID)

  assert.equal(response.ok, true)
  assert.equal(response.data.subjectUrl, `https://temporary.example/${encodeURIComponent(subjectFileId)}`)
  assert.equal(response.data.width, 300)
  assert.equal(response.data.height, 220)
  assert.equal(calls.downloadSource, 0)
  assert.equal(calls.moderate, 0)
  assert.equal(calls.prepareSubject.length, 0)
})

test('createWork reuses the prepared subject, background, and preparation expiry', async () => {
  const subjectFileId = `cloud://env/uploads/${UPLOAD_TICKET_ID}/${REQUEST_ID}/subject.png`
  const expiry = '2026-09-25T04:00:00.000Z'
  const ticket = makeUploadTicket({
    expiresAt: expiry,
    sourceExpiresAt: expiry,
    subjectFileId,
    subjectWidth: 320,
    subjectHeight: 240,
    subjectExpiresAt: expiry,
  })
  const { router, works, calls } = harness({
    tickets: [ticket],
    generated: {
      resultFileId: 'cloud://env/result.gif',
      coverFileId: 'cloud://env/cover.jpg',
      subjectFileId,
      outputBytes: 2048,
    },
  })

  const response = await router.dispatch('createWork', {
    requestId: ticket.requestId,
    uploadTicketId: ticket.id,
    sourceFileId: `cloud://env/${ticket.cloudPath}`,
    templateId: 'pat-head',
    editorState: { ...EDITOR_STATE, backgroundId: 'cream' },
  }, OPENID)

  assert.equal(response.ok, true)
  assert.equal(calls.downloadSource, 0)
  assert.equal(calls.moderate, 0)
  assert.deepEqual(calls.generate[0], {
    requestId: ticket.requestId,
    workId: workIdFor(OPENID, ticket.requestId),
    templateId: 'pat-head',
    subjectUrl: `https://temporary.example/${encodeURIComponent(subjectFileId)}`,
    reusedSubjectFileId: subjectFileId,
    editorState: { ...EDITOR_STATE, backgroundId: 'cream' },
  })
  const work = works.get(workIdFor(OPENID, ticket.requestId))
  assert.equal(work.sourceExpiresAt, expiry)
  assert.equal(work.subjectExpiresAt, expiry)
  assert.equal(work.subjectFileId, subjectFileId)
  assert.equal('subjectFileId' in response.data, false)
})

test('prepareSubject deletes the uploaded cutout when its ticket update fails', async () => {
  const ticket = makeUploadTicket()
  const subjectFileId = `cloud://env/uploads/${ticket.id}/${ticket.requestId}/subject.png`
  const { router, calls } = harness({
    tickets: [ticket],
    failTicketUpdate: true,
    prepareResult: { subjectFileId, width: 320, height: 240 },
  })

  const response = await router.dispatch('prepareSubject', {
    requestId: ticket.requestId,
    uploadTicketId: ticket.id,
    sourceFileId: `cloud://env/${ticket.cloudPath}`,
  }, OPENID)

  assert.deepEqual(response, { ok: false, error: { code: 'NETWORK_ERROR' } })
  assert.deepEqual(calls.deletedFiles, [[subjectFileId]])
})

test('prepareSubject logs the failing stage without exposing source URLs', async () => {
  const ticket = makeUploadTicket()
  const diagnostics = []
  const { router } = harness({
    tickets: [ticket],
    logger: { error: (event) => diagnostics.push(event) },
    failDownloadSource: Object.assign(
      new Error('private source URL must not be logged'),
      { code: 'SOURCE_UNAVAILABLE' },
    ),
  })

  const response = await router.dispatch('prepareSubject', {
    requestId: ticket.requestId,
    uploadTicketId: ticket.id,
    sourceFileId: `cloud://env/${ticket.cloudPath}`,
  }, OPENID)

  assert.deepEqual(response, { ok: false, error: { code: 'INVALID_IMAGE' } })
  assert.deepEqual(diagnostics, [
    {
      action: 'prepareSubject',
      stage: 'source-download',
      code: 'SOURCE_UNAVAILABLE',
    },
    { action: 'prepareSubject', code: 'INVALID_IMAGE' },
  ])
  assert.equal(JSON.stringify(diagnostics).includes('private'), false)
})
