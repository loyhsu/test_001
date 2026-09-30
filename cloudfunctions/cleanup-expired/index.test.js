const test = require('node:test')
const assert = require('node:assert/strict')

const { cleanupExpired } = require('./index')

const NOW = new Date('2026-09-24T04:00:00.000Z')

function createHarness(initialWorks, initialTickets = []) {
  const works = initialWorks.map((work) => ({ ...work }))
  const tickets = initialTickets.map((ticket) => ({ ...ticket }))
  const deletedBatches = []
  const updates = []
  const pageSizes = []
  const deletedTickets = []
  const deletedWorkRecords = []

  return {
    works,
    tickets,
    deletedBatches,
    deletedTickets,
    deletedWorkRecords,
    updates,
    pageSizes,
    dependencies: {
      now: NOW,
      async listWorks({ offset, limit }) {
        pageSizes.push(limit)
        return works.slice(offset, offset + limit)
      },
      async listExpiredUploadTickets({ offset, limit, now }) {
        const nowMs = new Date(now).getTime()
        return tickets
          .filter((ticket) => ticket.status === 'issued' && Date.parse(ticket.expiresAt) <= nowMs)
          .slice(offset, offset + limit)
      },
      async deleteUploadTicket(id) {
        deletedTickets.push(id)
        const index = tickets.findIndex((ticket) => ticket.id === id)
        if (index >= 0) tickets.splice(index, 1)
      },
      async updateWork(id, patch) {
        updates.push({ id, patch })
        const work = works.find((item) => item.id === id)
        Object.assign(work, patch)
      },
      async deleteWorkRecord(id) {
        deletedWorkRecords.push(id)
        const index = works.findIndex((item) => item.id === id)
        if (index >= 0) works.splice(index, 1)
      },
      async deleteFiles(fileIds) {
        deletedBatches.push(fileIds)
        return { fileList: fileIds.map((fileID) => ({ fileID, status: 0 })) }
      },
    },
  }
}

test('deletes expired original and subject files but retains live output and work', async () => {
  const harness = createHarness([{
    id: 'work-private-expired',
    status: 'ready',
    sourceFileId: 'cloud://env/source.jpg',
    sourceExpiresAt: '2026-09-24T03:59:00.000Z',
    subjectFileId: 'cloud://env/subject.png',
    subjectExpiresAt: '2026-09-24T03:59:00.000Z',
    resultFileId: 'cloud://env/result.gif',
    coverFileId: 'cloud://env/cover.jpg',
    expiresAt: '2026-10-24T03:59:00.000Z',
  }])

  const result = await cleanupExpired(harness.dependencies)

  assert.deepEqual(harness.deletedBatches, [[
    'cloud://env/source.jpg',
    'cloud://env/subject.png',
  ]])
  assert.deepEqual(harness.works[0], {
    id: 'work-private-expired',
    status: 'ready',
    sourceFileId: null,
    sourceExpiresAt: null,
    subjectFileId: null,
    subjectExpiresAt: null,
    resultFileId: 'cloud://env/result.gif',
    coverFileId: 'cloud://env/cover.jpg',
    expiresAt: '2026-10-24T03:59:00.000Z',
  })
  assert.equal(result.deletedFiles, 2)
  assert.equal(result.expiredWorks, 0)
})

test('deletes expired output and cover files', async () => {
  const harness = createHarness([{
    id: 'work-expired',
    status: 'ready',
    sourceFileId: null,
    subjectFileId: null,
    resultFileId: 'cloud://env/result.gif',
    coverFileId: 'cloud://env/cover.jpg',
    expiresAt: '2026-09-24T03:59:00.000Z',
  }])

  const result = await cleanupExpired(harness.dependencies)

  assert.deepEqual(harness.deletedBatches, [[
    'cloud://env/result.gif',
    'cloud://env/cover.jpg',
  ]])
  assert.equal(result.deletedFiles, 2)
})

test('retains an expired work record and clears its output references', async () => {
  const harness = createHarness([{
    id: 'work-expired',
    status: 'ready',
    sourceFileId: null,
    subjectFileId: null,
    resultFileId: null,
    coverFileId: null,
    expiresAt: '2026-09-24T03:59:00.000Z',
  }])

  const result = await cleanupExpired(harness.dependencies)

  assert.deepEqual(harness.works[0], {
    id: 'work-expired',
    status: 'expired',
    sourceFileId: null,
    subjectFileId: null,
    resultFileId: null,
    coverFileId: null,
    expiresAt: '2026-09-24T03:59:00.000Z',
  })
  assert.equal(result.expiredWorks, 1)
})

test('removes a deleted-work tombstone and consumed ticket after private files expire', async () => {
  const ticket = { id: 'consumed-ticket-123', status: 'consumed' }
  const harness = createHarness([{
    id: 'deleted-work-12345678',
    status: 'expired',
    deletedAt: '2026-09-23T04:00:00.000Z',
    uploadTicketId: ticket.id,
    sourceFileId: 'cloud://env/source.jpg',
    sourceExpiresAt: '2026-09-24T03:59:00.000Z',
    subjectFileId: 'cloud://env/subject.png',
    subjectExpiresAt: '2026-09-24T03:59:00.000Z',
    resultFileId: null,
    coverFileId: null,
    expiresAt: '2026-09-23T04:00:00.000Z',
  }], [ticket])

  await cleanupExpired(harness.dependencies)

  assert.deepEqual(harness.deletedBatches, [[
    'cloud://env/source.jpg',
    'cloud://env/subject.png',
  ]])
  assert.deepEqual(harness.deletedTickets, [ticket.id])
  assert.deepEqual(harness.deletedWorkRecords, ['deleted-work-12345678'])
  assert.deepEqual(harness.works, [])
})

test('treats already-missing storage files as cleaned up', async () => {
  const harness = createHarness([{
    id: 'work-missing-file',
    status: 'ready',
    sourceFileId: 'cloud://env/gone.jpg',
    sourceExpiresAt: '2026-09-24T03:59:00.000Z',
    subjectFileId: null,
    resultFileId: null,
    coverFileId: null,
    expiresAt: '2026-10-24T03:59:00.000Z',
  }])
  harness.dependencies.deleteFiles = async (fileIds) => {
    harness.deletedBatches.push(fileIds)
    return { fileList: [{ fileID: fileIds[0], status: -1, errMsg: 'file does not exist' }] }
  }

  await cleanupExpired(harness.dependencies)

  assert.equal(harness.works[0].sourceFileId, null)
  assert.equal(harness.updates.length, 1)
})

test('processes all work documents in pages of at most 100', async () => {
  const harness = createHarness(Array.from({ length: 205 }, (_, index) => ({
    id: `work-${index}`,
    status: 'ready',
    sourceFileId: null,
    subjectFileId: null,
    resultFileId: null,
    coverFileId: null,
    expiresAt: '2026-10-24T03:59:00.000Z',
  })))

  const result = await cleanupExpired(harness.dependencies)

  assert.equal(result.processed, 205)
  assert.equal(result.pages, 3)
  assert.deepEqual(harness.pageSizes, [100, 100, 100])
})

test('cleans expired issued ticket source and subject files before deleting its ticket', async () => {
  const ticket = {
    id: 'ticket-expired',
    status: 'issued',
    expiresAt: '2026-09-24T03:59:00.000Z',
    sourceFileId: 'cloud://env/uploads/ticket/source.jpg',
    subjectFileId: 'cloud://env/uploads/ticket/subject.png',
  }
  const harness = createHarness([], [ticket])

  const result = await cleanupExpired(harness.dependencies)

  assert.deepEqual(harness.deletedBatches, [[ticket.sourceFileId, ticket.subjectFileId]])
  assert.deepEqual(harness.deletedTickets, [ticket.id])
  assert.equal(harness.tickets.length, 0)
  assert.equal(result.expiredUploadTickets, 1)
  assert.equal(result.deletedFiles, 2)
})

test('keeps live and consumed upload tickets and their files untouched', async () => {
  const harness = createHarness([], [
    {
      id: 'ticket-live',
      status: 'issued',
      expiresAt: '2026-09-24T04:01:00.000Z',
      sourceFileId: 'cloud://env/live/source.jpg',
      subjectFileId: 'cloud://env/live/subject.png',
    },
    {
      id: 'ticket-consumed',
      status: 'consumed',
      expiresAt: '2026-09-24T03:00:00.000Z',
      sourceFileId: 'cloud://env/used/source.jpg',
      subjectFileId: 'cloud://env/used/subject.png',
    },
  ])

  const result = await cleanupExpired(harness.dependencies)

  assert.deepEqual(harness.deletedBatches, [])
  assert.deepEqual(harness.deletedTickets, [])
  assert.equal(harness.tickets.length, 2)
  assert.equal(result.expiredUploadTickets, 0)
})

test('keeps an expired ticket when its file deletion fails so cleanup can retry', async () => {
  const ticket = {
    id: 'ticket-retry',
    status: 'issued',
    expiresAt: '2026-09-24T03:59:00.000Z',
    sourceFileId: 'cloud://env/retry/source.jpg',
    subjectFileId: 'cloud://env/retry/subject.png',
  }
  const harness = createHarness([], [ticket])
  harness.dependencies.deleteFiles = async (fileIds) => {
    harness.deletedBatches.push(fileIds)
    throw new Error('storage temporarily unavailable')
  }

  await assert.rejects(cleanupExpired(harness.dependencies), /storage temporarily unavailable/)

  assert.equal(harness.tickets.length, 1)
  assert.deepEqual(harness.deletedTickets, [])
})

test('processes all expired tickets across batches while deleting records', async () => {
  const tickets = Array.from({ length: 125 }, (_, index) => ({
    id: `ticket-${index}`,
    status: 'issued',
    expiresAt: '2026-09-24T03:59:00.000Z',
    sourceFileId: `cloud://env/${index}/source.jpg`,
    subjectFileId: null,
  }))
  const harness = createHarness([], tickets)

  const result = await cleanupExpired(harness.dependencies)

  assert.equal(harness.deletedTickets.length, 125)
  assert.equal(harness.tickets.length, 0)
  assert.equal(result.expiredUploadTickets, 125)
  assert.equal(result.deletedFiles, 125)
})
