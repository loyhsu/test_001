const MAX_PAGE_SIZE = 100

function isMissingFile(errorOrItem) {
  const code = String(errorOrItem?.errCode ?? errorOrItem?.code ?? '')
  const message = String(errorOrItem?.errMsg ?? errorOrItem?.message ?? '')
  return /not exist|not found|does not exist|no such file/i.test(message)
    || code === 'FILE_NOT_FOUND'
}

function isMissingDocument(error) {
  const code = String(error?.errCode ?? error?.code ?? '')
  const message = String(error?.errMsg ?? error?.message ?? '')
  return code === '-502005' || /document.*(not exist|not found)|does not exist/i.test(message)
}

async function deleteExpiredFiles(fileIds, deleteFiles) {
  const uniqueFileIds = [...new Set(fileIds.filter((fileId) => typeof fileId === 'string' && fileId))]
  if (uniqueFileIds.length === 0) return 0

  let result
  try {
    result = await deleteFiles(uniqueFileIds)
  } catch (error) {
    if (isMissingFile(error)) return uniqueFileIds.length
    throw error
  }

  const results = Array.isArray(result)
    ? result
    : result?.fileList ?? result?.data?.fileList ?? []
  for (const item of results) {
    if (item?.status !== undefined && item.status !== 0 && !isMissingFile(item)) {
      throw new Error(`Unable to delete expired file: ${item.errMsg || item.fileID || 'unknown error'}`)
    }
  }
  return uniqueFileIds.length
}

function isExpired(expiry, nowMs) {
  const expiryMs = Date.parse(expiry || '')
  return Number.isFinite(expiryMs) && expiryMs <= nowMs
}

async function cleanupExpired({
  listWorks,
  updateWork,
  listExpiredUploadTickets,
  deleteUploadTicket,
  deleteWorkRecord,
  deleteFiles,
  now = new Date(),
}) {
  if (
    ![
      listWorks,
      updateWork,
      listExpiredUploadTickets,
      deleteUploadTicket,
      deleteWorkRecord,
      deleteFiles,
    ]
      .every((dependency) => typeof dependency === 'function')
  ) {
    throw new TypeError('cleanup dependencies are required')
  }

  const nowMs = new Date(now).getTime()
  if (!Number.isFinite(nowMs)) throw new TypeError('now must be a valid date')

  let offset = 0
  let pages = 0
  let processed = 0
  let deletedFiles = 0
  let expiredWorks = 0
  let expiredUploadTickets = 0
  const deletedWorkRecords = []

  while (true) {
    const works = await listWorks({ offset, limit: MAX_PAGE_SIZE })
    if (!Array.isArray(works)) throw new TypeError('listWorks must return an array')
    pages += 1

    for (const work of works) {
      processed += 1
      const patch = {}
      const privateFileIds = []

      if (work.sourceFileId && isExpired(work.sourceExpiresAt, nowMs)) {
        privateFileIds.push(work.sourceFileId)
        patch.sourceFileId = null
        patch.sourceExpiresAt = null
      }
      if (work.subjectFileId && isExpired(work.subjectExpiresAt, nowMs)) {
        privateFileIds.push(work.subjectFileId)
        patch.subjectFileId = null
        patch.subjectExpiresAt = null
      }

      deletedFiles += await deleteExpiredFiles(privateFileIds, deleteFiles)

      if (isExpired(work.expiresAt, nowMs)) {
        const outputFileIds = [work.resultFileId, work.coverFileId]
        deletedFiles += await deleteExpiredFiles(outputFileIds, deleteFiles)
        if (work.status !== 'expired') expiredWorks += 1
        patch.status = 'expired'
        patch.resultFileId = null
        patch.coverFileId = null
      }

      const sourceExpired = !work.sourceFileId || isExpired(work.sourceExpiresAt, nowMs)
      const subjectExpired = !work.subjectFileId || isExpired(work.subjectExpiresAt, nowMs)
      if (work.uploadTicketId && sourceExpired && subjectExpired) {
        await deleteUploadTicket(work.uploadTicketId)
        patch.uploadTicketId = null
      }

      if (Object.keys(patch).length > 0) await updateWork(work.id, patch)
      if (work.deletedAt && sourceExpired && subjectExpired) deletedWorkRecords.push(work.id)
    }

    if (works.length < MAX_PAGE_SIZE) break
    offset += works.length
  }

  for (const id of deletedWorkRecords) await deleteWorkRecord(id)

  while (true) {
    const tickets = await listExpiredUploadTickets({
      offset: 0,
      limit: MAX_PAGE_SIZE,
      now: new Date(nowMs).toISOString(),
    })
    if (!Array.isArray(tickets)) {
      throw new TypeError('listExpiredUploadTickets must return an array')
    }

    const expiredTickets = tickets.filter(
      (ticket) => ticket.status === 'issued' && isExpired(ticket.expiresAt, nowMs),
    )
    if (expiredTickets.length === 0) break

    for (const ticket of expiredTickets) {
      deletedFiles += await deleteExpiredFiles(
        [ticket.sourceFileId, ticket.subjectFileId],
        deleteFiles,
      )
      await deleteUploadTicket(ticket.id)
      expiredUploadTickets += 1
    }

    if (tickets.length < MAX_PAGE_SIZE) break
  }

  return { pages, processed, deletedFiles, expiredWorks, expiredUploadTickets }
}

async function main() {
  const cloud = require('wx-server-sdk')
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
  const database = cloud.database()
  const works = database.collection('works')
  const uploadTickets = database.collection('upload_tickets')

  return cleanupExpired({
    listWorks: async ({ offset, limit }) => {
      const result = await works.orderBy('createdAt', 'asc').skip(offset).limit(limit).get()
      return result?.data || []
    },
    updateWork: async (id, patch) => works.doc(id).update({ data: patch }),
    listExpiredUploadTickets: async ({ offset, limit, now }) => {
      const result = await uploadTickets
        .where({ status: 'issued', expiresAt: database.command.lte(now) })
        .orderBy('expiresAt', 'asc')
        .skip(offset)
        .limit(limit)
        .get()
      return result?.data || []
    },
    deleteUploadTicket: async (id) => {
      try {
        await uploadTickets.doc(id).remove()
      } catch (error) {
        if (!isMissingDocument(error)) throw error
      }
    },
    deleteWorkRecord: async (id) => works.doc(id).remove(),
    deleteFiles: async (fileList) => cloud.deleteFile({ fileList }),
  })
}

exports.main = main
exports.cleanupExpired = cleanupExpired
exports.deleteExpiredFiles = deleteExpiredFiles
