const assert = require('node:assert/strict')
const test = require('node:test')

const { createRepository } = require('./repository')

function databaseWith(works, tickets = {}) {
  const documents = new Map([
    ...Object.entries(works).map(([id, work]) => [`works/${id}`, work]),
    ...Object.entries(tickets).map(([id, ticket]) => [`upload_tickets/${id}`, ticket]),
  ])
  const database = {
    command: {
      exists(value) { return { exists: value } },
    },
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`
          return {
            async get() {
              return { data: documents.get(key) ?? null }
            },
            async set({ data }) {
              documents.set(key, data)
            },
            async update({ data }) {
              documents.set(key, { ...documents.get(key), ...data })
            },
          }
        },
        where(query) {
          const cursor = {
            limitValue: Infinity,
            orderBy() { return this },
            limit(value) { this.limitValue = value; return this },
            async get() {
              const data = [...documents.entries()]
                .filter(([key]) => key.startsWith(`${name}/`))
                .map(([, value]) => value)
                .filter((value) => value.openid === query.openid)
                .filter((value) => query.deletedAt?.exists !== false || !Object.hasOwn(value, 'deletedAt'))
              return { data: data.slice(0, cursor.limitValue) }
            },
          }
          return cursor
        },
      }
    },
    async runTransaction(operation) {
      return operation(database)
    },
  }
  return { database, documents }
}

const now = '2026-09-24T04:00:00.000Z'
const parent = {
  id: 'source-work-12345678',
  openid: 'owner',
  sourceFileId: 'cloud://env/source.png',
  sourceExpiresAt: '2026-09-25T03:00:00.000Z',
  subjectFileId: 'cloud://env/subject.png',
  subjectExpiresAt: '2026-09-25T03:00:00.000Z',
}
const child = {
  id: 'child-work-12345678',
  openid: 'owner',
  requestId: 'request-123',
  status: 'processing',
  sourceWorkId: parent.id,
  sourceFileId: parent.sourceFileId,
  sourceExpiresAt: parent.sourceExpiresAt,
  subjectFileId: parent.subjectFileId,
  subjectExpiresAt: parent.subjectExpiresAt,
  createdAt: now,
}

test('creates a child work transactionally from the owner’s unexpired private subject', async () => {
  const { database, documents } = databaseWith({ [parent.id]: parent })
  const repository = createRepository(database)

  const result = await repository.createProcessingWork(child, undefined, 'owner')

  assert.deepEqual(result, { created: true, work: child })
  assert.equal(documents.get(`works/${child.id}`).subjectFileId, parent.subjectFileId)
})

test('soft-deletes a work without losing private file references before expiry cleanup', async () => {
  const deletedAt = '2026-09-24T04:00:00.000Z'
  const work = {
    ...parent,
    status: 'expired',
    resultFileId: 'cloud://env/result.gif',
    coverFileId: 'cloud://env/cover.jpg',
    expiresAt: deletedAt,
  }
  const active = { id: 'active-work-12345678', openid: 'owner', status: 'ready' }
  const { database, documents } = databaseWith({ [work.id]: work, [active.id]: active })
  const repository = createRepository(database)

  await repository.deleteWork(work.id, {
    deletedAt,
    expiresAt: deletedAt,
    resultFileId: null,
    coverFileId: null,
    openid: null,
    requestId: null,
    templateId: null,
    editorState: null,
  })

  const tombstone = documents.get(`works/${work.id}`)
  assert.equal(tombstone.deletedAt, deletedAt)
  assert.equal(tombstone.sourceFileId, parent.sourceFileId)
  assert.equal(tombstone.subjectFileId, parent.subjectFileId)
  assert.equal(tombstone.resultFileId, null)
  assert.equal(tombstone.openid, null)
  assert.equal(await repository.getOwnedWork(work.id, 'owner'), null)
  assert.deepEqual(await repository.listOwnedWorks('owner', 50), [active])
})

test('does not create a child work from another user’s source record', async () => {
  const foreignParent = { ...parent, openid: 'someone-else' }
  const { database, documents } = databaseWith({ [parent.id]: foreignParent })
  const repository = createRepository(database)

  await assert.rejects(
    repository.createProcessingWork(child, undefined, 'owner'),
    (error) => error.code === 'NOT_FOUND',
  )
  assert.equal(documents.has(`works/${child.id}`), false)
})

test('consumes only an owned, unexpired ticket with a prepared subject and matching source', async () => {
  const ticketId = 'b1000000-0000-4000-8000-000000000001'
  const ticket = {
    id: ticketId,
    openid: 'owner',
    requestId: 'request-123',
    cloudPath: `uploads/${ticketId}/request-123/source.jpg`,
    status: 'issued',
    expiresAt: '2026-09-25T04:00:00.000Z',
    sourceExpiresAt: '2026-09-25T04:00:00.000Z',
    subjectFileId: `cloud://env/uploads/${ticketId}/request-123/subject.png`,
    subjectExpiresAt: '2026-09-25T04:00:00.000Z',
  }
  const work = {
    id: 'new-work-12345678',
    openid: 'owner',
    requestId: 'request-123',
    sourceFileId: `cloud://env/${ticket.cloudPath}`,
    sourceExpiresAt: ticket.sourceExpiresAt,
    subjectFileId: ticket.subjectFileId,
    subjectExpiresAt: ticket.subjectExpiresAt,
    createdAt: now,
  }
  const { database, documents } = databaseWith({}, { [ticketId]: ticket })
  const repository = createRepository(database)

  const result = await repository.createProcessingWork(work, ticketId, 'owner')

  assert.deepEqual(result, { created: true, work })
  const consumedTicket = documents.get(`upload_tickets/${ticketId}`)
  assert.equal(consumedTicket.status, 'consumed')
  assert.equal(consumedTicket.openid, null)
  assert.equal(consumedTicket.sourceFileId, null)
  assert.equal(consumedTicket.subjectFileId, null)
  assert.equal(documents.get(`works/${work.id}`).subjectFileId, ticket.subjectFileId)
})

test('rejects foreign, expired, unprepared, or mismatched upload tickets transactionally', async () => {
  const ticketId = 'b1000000-0000-4000-8000-000000000001'
  const baseTicket = {
    id: ticketId,
    openid: 'owner',
    requestId: 'request-123',
    cloudPath: `uploads/${ticketId}/request-123/source.jpg`,
    status: 'issued',
    expiresAt: '2026-09-25T04:00:00.000Z',
    sourceExpiresAt: '2026-09-25T04:00:00.000Z',
    subjectFileId: `cloud://env/uploads/${ticketId}/request-123/subject.png`,
    subjectExpiresAt: '2026-09-25T04:00:00.000Z',
  }
  const baseWork = {
    id: 'new-work-12345678',
    openid: 'owner',
    requestId: 'request-123',
    sourceFileId: `cloud://env/${baseTicket.cloudPath}`,
    sourceExpiresAt: baseTicket.sourceExpiresAt,
    subjectFileId: baseTicket.subjectFileId,
    subjectExpiresAt: baseTicket.subjectExpiresAt,
    createdAt: now,
  }
  const cases = [
    [{ ...baseTicket, openid: 'other' }, baseWork, 'UPLOAD_TICKET_INVALID'],
    [{ ...baseTicket, expiresAt: '2026-09-24T03:59:00.000Z' }, baseWork, 'UPLOAD_TICKET_INVALID'],
    [{ ...baseTicket, subjectFileId: undefined }, baseWork, 'UPLOAD_TICKET_INVALID'],
    [baseTicket, { ...baseWork, sourceFileId: 'cloud://env/uploads/other/source.jpg' }, 'UPLOAD_TICKET_INVALID'],
  ]

  for (const [ticket, work, code] of cases) {
    const { database, documents } = databaseWith({}, { [ticketId]: ticket })
    const repository = createRepository(database)
    await assert.rejects(
      repository.createProcessingWork(work, ticketId, 'owner'),
      (error) => error.code === code,
    )
    assert.equal(documents.has(`works/${work.id}`), false)
    assert.equal(documents.get(`upload_tickets/${ticketId}`).status, 'issued')
  }
})
