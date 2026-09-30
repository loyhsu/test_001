const { createHash } = require('crypto')

const {
  EVENT_FIELDS,
  FAILURE_CODES,
  ServiceError,
  TEMPLATE_IDS,
  normalizeFailureCode,
  publicWork,
} = require('./contracts')

const REQUEST_ID = /^[a-zA-Z0-9_-]{8,64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png'])
const SPEEDS = new Set(['slow', 'standard', 'fast'])
const BACKGROUND_IDS = new Set(['template', 'sky-blue', 'cream', 'lavender'])
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const WORK_TTL_MS = 30 * 24 * 60 * 60 * 1000
const PRIVATE_IMAGE_TTL_MS = 24 * 60 * 60 * 1000
const UPLOAD_TICKET_TTL_MS = 15 * 60 * 1000
const RETRYABLE_FAILURES = new Set(['MATTING_FAILED', 'ENCODING_FAILED', 'NETWORK_ERROR'])

function success(data) {
  return { ok: true, data }
}

function failure(code) {
  return { ok: false, error: { code } }
}

function requireString(value, min = 1, max = 512) {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function validateRequestId(value) {
  if (!requireString(value, 8, 64) || !REQUEST_ID.test(value)) {
    throw new ServiceError('INVALID_INPUT')
  }
}

function validateEditorState(value) {
  const backgroundId = value?.backgroundId ?? 'template'
  if (
    !value ||
    !Number.isFinite(value.x) || value.x < 0 || value.x > 480 ||
    !Number.isFinite(value.y) || value.y < 0 || value.y > 480 ||
    !Number.isFinite(value.scale) || value.scale < 0.65 || value.scale > 1.6 ||
    !SPEEDS.has(value.speed) ||
    !BACKGROUND_IDS.has(backgroundId)
  ) {
    throw new ServiceError('INVALID_INPUT')
  }
  return { x: value.x, y: value.y, scale: value.scale, speed: value.speed, backgroundId }
}

function workIdFor(openid, requestId) {
  return createHash('sha256').update(`${openid}\u0000${requestId}`).digest('hex')
}

function pathFromCloudFileId(fileID) {
  const match = /^cloud:\/\/[^/]+\/(.+)$/.exec(fileID)
  return match?.[1] || ''
}

function assertUploadTicket(ticket, { openid, requestId, sourceFileId, now }) {
  if (
    !ticket ||
    ticket.openid !== openid ||
    ticket.requestId !== requestId ||
    ticket.status !== 'issued' ||
    Date.parse(ticket.expiresAt) <= now.getTime() ||
    pathFromCloudFileId(sourceFileId) !== ticket.cloudPath
  ) {
    throw new ServiceError('UPLOAD_TICKET_INVALID')
  }
}

function isExpired(work, now) {
  return Date.parse(work.expiresAt) <= now.getTime()
}

async function publicWorkWithUrls(work, dependencies, options = {}) {
  const now = dependencies.now().getTime()
  if (isExpired(work, new Date(now))) return publicWork(work, { now })
  if (work.status !== 'ready') return publicWork(work, { now })

  const fileIDs = []
  if (work.coverFileId) fileIDs.push(work.coverFileId)
  if (options.includeResult && work.resultFileId) fileIDs.push(work.resultFileId)
  const urls = await dependencies.getTemporaryFileUrls(fileIDs)
  return publicWork(
    {
      ...work,
      coverUrl: work.coverFileId ? urls.get(work.coverFileId) : undefined,
      resultUrl: options.includeResult && work.resultFileId ? urls.get(work.resultFileId) : undefined,
    },
    { now, includeCoverUrl: true, includeResultUrl: options.includeResult === true },
  )
}

function validateEvent(event, openid, now, createId) {
  if (!event || !Object.hasOwn(EVENT_FIELDS, event.eventName)) {
    throw new ServiceError('INVALID_INPUT')
  }
  const supplied = event.properties && typeof event.properties === 'object'
    ? event.properties
    : {}
  const properties = {}

  for (const field of EVENT_FIELDS[event.eventName]) {
    const value = supplied[field] ?? event[field]
    if (value === undefined) continue
    if (field === 'templateId' || field === 'nextTemplateId') {
      if (typeof value !== 'string' || !TEMPLATE_IDS.has(value)) throw new ServiceError('INVALID_INPUT')
      properties[field] = value
    } else if (field === 'failureCode') {
      if (!FAILURE_CODES.has(value)) throw new ServiceError('INVALID_INPUT')
      properties[field] = value
    } else if (field === 'sessionId' || field === 'workId') {
      if (!requireString(value, 8, 128)) throw new ServiceError('INVALID_INPUT')
      properties[field] = value
    } else if (field === 'durationMs' || field === 'outputKb' || field === 'sizeKb') {
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
        throw new ServiceError('INVALID_INPUT')
      }
      properties[field] = value
    }
  }

  return {
    id: createId(),
    eventName: event.eventName,
    openidHash: createHash('sha256').update(openid).digest('hex'),
    sessionId: properties.sessionId,
    templateId: properties.templateId,
    workId: properties.workId,
    properties,
    occurredAt: now.toISOString(),
  }
}

function createRouter(dependencies) {
  async function runDiagnosticStage(action, stage, operation) {
    try {
      return await operation()
    } catch (error) {
      const rawCode = error?.code
      const textCode = typeof rawCode === 'number' && Number.isInteger(rawCode)
        ? String(rawCode)
        : typeof rawCode === 'string' ? rawCode : ''
      const code = /^[A-Za-z0-9_.:-]{1,128}$/.test(textCode) ? textCode : 'UNKNOWN'
      try {
        dependencies.logger?.error?.({ action, stage, code })
      } catch {
        // Diagnostics must not replace the original failure.
      }
      throw error
    }
  }

  async function createUploadTicket(payload, openid) {
    validateRequestId(payload?.requestId)
    if (!IMAGE_TYPES.has(payload?.imageType)) throw new ServiceError('INVALID_INPUT')

    const now = dependencies.now()
    const id = dependencies.createId()
    const ticket = {
      id,
      openid,
      requestId: payload.requestId,
      imageType: payload.imageType,
      cloudPath: `uploads/${id}/${payload.requestId}/source.${payload.imageType}`,
      status: 'issued',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + UPLOAD_TICKET_TTL_MS).toISOString(),
    }
    await dependencies.repository.createUploadTicket(ticket)
    return { uploadTicketId: id, cloudPath: ticket.cloudPath, expiresAt: ticket.expiresAt }
  }

  async function temporaryUrl(fileId) {
    const urls = await dependencies.getTemporaryFileUrls([fileId])
    const url = urls.get(fileId)
    if (!url) throw new ServiceError('NETWORK_ERROR')
    return url
  }

  async function sourceForExistingWork(work, now) {
    if (
      work.subjectFileId &&
      Date.parse(work.subjectExpiresAt || '') > now.getTime()
    ) {
      return {
        subjectUrl: await temporaryUrl(work.subjectFileId),
        reusedSubjectFileId: work.subjectFileId,
      }
    }
    if (
      work.sourceFileId &&
      Date.parse(work.sourceExpiresAt || '') > now.getTime()
    ) {
      return { sourceUrl: await temporaryUrl(work.sourceFileId) }
    }
    throw new ServiceError('SUBJECT_EXPIRED')
  }

  async function prepareSubject(payload, openid) {
    validateRequestId(payload?.requestId)
    if (!UUID.test(payload?.uploadTicketId || '') || !requireString(payload?.sourceFileId)) {
      throw new ServiceError('INVALID_INPUT')
    }

    const ticket = await runDiagnosticStage(
      'prepareSubject',
      'ticket-read',
      () => dependencies.repository.getUploadTicket(payload.uploadTicketId),
    )
    const now = dependencies.now()
    assertUploadTicket(ticket, {
      openid,
      requestId: payload.requestId,
      sourceFileId: payload.sourceFileId,
      now,
    })

    const subjectObjectPath = `uploads/${ticket.id}/${ticket.requestId}/subject.png`
    if (ticket.subjectFileId) {
      if (
        !ticket.subjectFileId.startsWith('cloud://') ||
        pathFromCloudFileId(ticket.subjectFileId) !== subjectObjectPath ||
        !Number.isInteger(ticket.subjectWidth) || ticket.subjectWidth <= 0 ||
        !Number.isInteger(ticket.subjectHeight) || ticket.subjectHeight <= 0 ||
        Date.parse(ticket.subjectExpiresAt || '') <= now.getTime()
      ) {
        throw new ServiceError('SUBJECT_EXPIRED')
      }
      return {
        subjectUrl: await runDiagnosticStage(
          'prepareSubject',
          'existing-subject-url',
          () => temporaryUrl(ticket.subjectFileId),
        ),
        width: ticket.subjectWidth,
        height: ticket.subjectHeight,
        expiresAt: ticket.subjectExpiresAt,
      }
    }

    let source
    try {
      source = await runDiagnosticStage(
        'prepareSubject',
        'source-download',
        () => dependencies.downloadSource(payload.sourceFileId),
      )
    } catch {
      throw new ServiceError('INVALID_IMAGE')
    }
    if (!Buffer.isBuffer(source) || source.length === 0) throw new ServiceError('INVALID_IMAGE')
    if (source.length > MAX_IMAGE_BYTES) throw new ServiceError('IMAGE_TOO_LARGE')
    await runDiagnosticStage(
      'prepareSubject',
      'image-moderation',
      () => dependencies.moderate(source, ticket.imageType),
    )

    const sourceUrl = await runDiagnosticStage(
      'prepareSubject',
      'source-temp-url',
      () => temporaryUrl(payload.sourceFileId),
    )
    const prepared = await runDiagnosticStage(
      'prepareSubject',
      'generator-call',
      () => dependencies.prepareSubject({ sourceUrl, subjectObjectPath }),
    )
    const expectedSubjectFileIdPath = subjectObjectPath
    if (
      !prepared ||
      typeof prepared.subjectFileId !== 'string' ||
      !prepared.subjectFileId.startsWith('cloud://') ||
      pathFromCloudFileId(prepared.subjectFileId) !== expectedSubjectFileIdPath ||
      !Number.isInteger(prepared.width) || prepared.width <= 0 ||
      !Number.isInteger(prepared.height) || prepared.height <= 0
    ) {
      if (
        typeof prepared?.subjectFileId === 'string' &&
        prepared.subjectFileId.startsWith('cloud://') &&
        pathFromCloudFileId(prepared.subjectFileId) === subjectObjectPath
      ) {
        try {
          await dependencies.deleteFiles([prepared.subjectFileId])
        } catch {
          // The issued ticket cleanup will remove any orphan remaining after a storage failure.
        }
      }
      throw new ServiceError('ENCODING_FAILED')
    }

    const completedAt = dependencies.now()
    const expiresAt = new Date(completedAt.getTime() + PRIVATE_IMAGE_TTL_MS).toISOString()
    try {
      const updated = await runDiagnosticStage(
        'prepareSubject',
        'ticket-update',
        () => dependencies.repository.updateUploadTicket(ticket.id, {
          sourceFileId: payload.sourceFileId,
          sourceExpiresAt: expiresAt,
          subjectFileId: prepared.subjectFileId,
          subjectWidth: prepared.width,
          subjectHeight: prepared.height,
          subjectExpiresAt: expiresAt,
          preparedAt: completedAt.toISOString(),
          expiresAt,
        }),
      )
      if (updated?.subjectFileId !== prepared.subjectFileId) {
        throw new Error('prepared subject was not persisted')
      }
    } catch {
      try {
        await dependencies.deleteFiles([prepared.subjectFileId])
      } catch {
        // Leave the original error stable; the expired issued-ticket cleanup can retry orphan removal.
      }
      throw new ServiceError('NETWORK_ERROR')
    }

    return {
      subjectUrl: await runDiagnosticStage(
        'prepareSubject',
        'subject-temp-url',
        () => temporaryUrl(prepared.subjectFileId),
      ),
      width: prepared.width,
      height: prepared.height,
      expiresAt,
    }
  }

  async function runGeneration(work, generationSource) {
    const workId = work.id
    try {
      await dependencies.repository.updateWork(workId, { status: 'processing', failureCode: null })
      const generated = await dependencies.generate({
        requestId: work.requestId,
        workId,
        templateId: work.templateId,
        ...generationSource,
        editorState: work.editorState,
      })
      if (
        generationSource.reusedSubjectFileId &&
        generated.subjectFileId !== generationSource.reusedSubjectFileId
      ) {
        throw new ServiceError('ENCODING_FAILED')
      }
      const ready = await dependencies.repository.updateWork(workId, {
        status: 'ready',
        resultFileId: generated.resultFileId,
        coverFileId: generated.coverFileId,
        subjectFileId: generated.subjectFileId,
        subjectExpiresAt: work.subjectExpiresAt || work.sourceExpiresAt,
        outputBytes: generated.outputBytes,
        failureCode: null,
      })
      if (ready.deletedAt) {
        await dependencies.deleteFiles([ready.resultFileId, ready.coverFileId].filter(Boolean))
        const hidden = await dependencies.repository.updateWork(workId, {
          resultFileId: null,
          coverFileId: null,
        })
        return publicWork(hidden, { now: dependencies.now().getTime() })
      }
      return publicWorkWithUrls(ready, dependencies, { includeResult: true })
    } catch (error) {
      const failed = await dependencies.repository.updateWork(workId, {
        status: 'failed',
        failureCode: normalizeFailureCode(error),
      })
      return publicWork(failed, { now: dependencies.now().getTime() })
    }
  }

  async function createWork(payload, openid) {
    validateRequestId(payload?.requestId)
    if (!TEMPLATE_IDS.has(payload?.templateId)) throw new ServiceError('INVALID_INPUT')
    const editorState = validateEditorState(payload.editorState)
    const workId = workIdFor(openid, payload.requestId)
    const now = dependencies.now()

    const existing = await dependencies.repository.getWork(workId)
    if (existing) {
      if (existing.openid !== openid || existing.deletedAt) throw new ServiceError('NOT_FOUND')
      if (existing.status !== 'failed' || !RETRYABLE_FAILURES.has(existing.failureCode)) {
        return publicWorkWithUrls(existing, dependencies, { includeResult: true })
      }
      return runGeneration(existing, await sourceForExistingWork(existing, now))
    }

    let sourceFileId
    let uploadTicketId
    let uploadTicket
    let sourceWorkId
    let generationSource
    let sourceWork

    if (payload?.sourceWorkId !== undefined) {
      if (
        !requireString(payload.sourceWorkId, 8, 128) ||
        payload.sourceFileId !== undefined ||
        payload.uploadTicketId !== undefined
      ) {
        throw new ServiceError('INVALID_INPUT')
      }
      sourceWork = await dependencies.repository.getOwnedWork(payload.sourceWorkId, openid)
      if (!sourceWork) throw new ServiceError('NOT_FOUND')
      generationSource = await sourceForExistingWork(sourceWork, now)
      sourceFileId = sourceWork.sourceFileId
      sourceWorkId = sourceWork.id
    } else {
      validateRequestId(payload?.requestId)
      if (!UUID.test(payload?.uploadTicketId || '') || !requireString(payload?.sourceFileId)) {
        throw new ServiceError('INVALID_INPUT')
      }
      uploadTicketId = payload.uploadTicketId
      sourceFileId = payload.sourceFileId
      uploadTicket = await dependencies.repository.getUploadTicket(uploadTicketId)
      assertUploadTicket(uploadTicket, { openid, requestId: payload.requestId, sourceFileId, now })
      if (!uploadTicket.subjectFileId || !uploadTicket.subjectExpiresAt) {
        throw new ServiceError('UPLOAD_TICKET_INVALID')
      }
      if (Date.parse(uploadTicket.subjectExpiresAt) <= now.getTime()) {
        throw new ServiceError('SUBJECT_EXPIRED')
      }
      generationSource = {
        subjectUrl: await temporaryUrl(uploadTicket.subjectFileId),
        reusedSubjectFileId: uploadTicket.subjectFileId,
      }
    }

    const sourceExpiresAt = sourceWork?.sourceExpiresAt || uploadTicket?.sourceExpiresAt
      || new Date(now.getTime() + PRIVATE_IMAGE_TTL_MS).toISOString()
    const work = {
      id: workId,
      openid,
      requestId: payload.requestId,
      templateId: payload.templateId,
      status: 'processing',
      sourceFileId,
      sourceExpiresAt,
      subjectFileId: generationSource.reusedSubjectFileId,
      subjectExpiresAt: generationSource.reusedSubjectFileId
        ? (sourceWork?.subjectExpiresAt || uploadTicket?.subjectExpiresAt)
        : undefined,
      sourceWorkId,
      uploadTicketId,
      editorState,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + WORK_TTL_MS).toISOString(),
    }
    const created = await dependencies.repository.createProcessingWork(work, uploadTicketId, openid)
    if (!created.created) {
      if (created.work.openid !== openid || created.work.deletedAt) throw new ServiceError('NOT_FOUND')
      return publicWorkWithUrls(created.work, dependencies, { includeResult: true })
    }

    return runGeneration(work, generationSource)
  }

  async function getWork(payload, openid) {
    if (!requireString(payload?.workId, 8, 128)) throw new ServiceError('INVALID_INPUT')
    const work = await dependencies.repository.getOwnedWork(payload.workId, openid)
    if (!work) throw new ServiceError('NOT_FOUND')
    return publicWorkWithUrls(work, dependencies, { includeResult: true })
  }

  async function listWorks(_payload, openid) {
    const now = dependencies.now()
    const works = await dependencies.repository.listOwnedWorks(openid, 50)
    const coverIDs = works
      .filter((work) => work.status === 'ready' && !isExpired(work, now) && work.coverFileId)
      .map((work) => work.coverFileId)
    const urls = await dependencies.getTemporaryFileUrls([...new Set(coverIDs)])
    return works.map((work) => publicWork(
      { ...work, coverUrl: work.coverFileId ? urls.get(work.coverFileId) : undefined },
      { now: now.getTime(), includeCoverUrl: true },
    ))
  }

  async function deleteWork(payload, openid) {
    if (!requireString(payload?.workId, 8, 128)) throw new ServiceError('INVALID_INPUT')
    const work = await dependencies.repository.getOwnedWork(payload.workId, openid)
    if (!work) throw new ServiceError('NOT_FOUND')
    const files = [...new Set([work.resultFileId, work.coverFileId].filter(Boolean))]
    await dependencies.deleteFiles(files)
    const deletedAt = dependencies.now().toISOString()
    await dependencies.repository.deleteWork(work.id, {
      status: 'expired',
      deletedAt,
      expiresAt: deletedAt,
      resultFileId: null,
      coverFileId: null,
      openid: null,
      requestId: null,
      templateId: null,
      editorState: null,
      sourceWorkId: null,
      failureCode: null,
      outputBytes: null,
    })
    return { deleted: true }
  }

  async function trackEvent(payload, openid) {
    const event = validateEvent(payload, openid, dependencies.now(), dependencies.createId)
    await dependencies.repository.addEvent(event)
    return { accepted: true }
  }

  async function trackEvents(payload, openid) {
    if (!Array.isArray(payload?.events) || payload.events.length < 1 || payload.events.length > 20) {
      throw new ServiceError('INVALID_INPUT')
    }
    const events = payload.events.map((event) =>
      validateEvent(event, openid, dependencies.now(), dependencies.createId))
    await dependencies.repository.addEvents(events)
    return { accepted: events.length }
  }

  async function dispatch(action, payload, openid) {
    if (!openid) return failure('UNAUTHENTICATED')
    try {
      switch (action) {
        case 'createUploadTicket':
          return success(await createUploadTicket(payload || {}, openid))
        case 'prepareSubject':
          return success(await prepareSubject(payload || {}, openid))
        case 'createWork':
          return success(await createWork(payload || {}, openid))
        case 'getWork':
          return success(await getWork(payload || {}, openid))
        case 'listWorks':
          return success(await listWorks(payload || {}, openid))
        case 'deleteWork':
          return success(await deleteWork(payload || {}, openid))
        case 'trackEvent':
          return success(await trackEvent(payload || {}, openid))
        case 'trackEvents':
          return success(await trackEvents(payload || {}, openid))
        default:
          return failure('INVALID_ACTION')
      }
    } catch (error) {
      const code = error instanceof ServiceError ? error.code : 'INTERNAL_ERROR'
      dependencies.logger?.error?.({
        action: typeof action === 'string' ? action : 'unknown',
        code,
      })
      return failure(code)
    }
  }

  return { dispatch }
}

module.exports = { createRouter, pathFromCloudFileId, workIdFor }
