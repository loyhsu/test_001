const { ServiceError } = require('./contracts')

const WORKS_COLLECTION = 'works'
const UPLOAD_TICKETS_COLLECTION = 'upload_tickets'
const EVENTS_COLLECTION = 'analytics_events'

function isMissingDocument(error) {
  const code = String(error?.errCode ?? error?.code ?? '')
  const message = String(error?.errMsg ?? error?.message ?? '')
  return code === '-502005' || /document.*(not exist|not found)|does not exist/i.test(message)
}

function pathFromCloudFileId(fileID) {
  const match = /^cloud:\/\/[^/]+\/(.+)$/.exec(fileID || '')
  return match?.[1] || ''
}

async function readDocument(reference) {
  try {
    const result = await reference.get()
    return result?.data || null
  } catch (error) {
    if (isMissingDocument(error)) return null
    throw error
  }
}

function createRepository(database) {
  return {
    async createUploadTicket(ticket) {
      await database.collection(UPLOAD_TICKETS_COLLECTION).doc(ticket.id).set({ data: ticket })
      return ticket
    },

    async getUploadTicket(id) {
      return readDocument(database.collection(UPLOAD_TICKETS_COLLECTION).doc(id))
    },

    async updateUploadTicket(id, patch) {
      const reference = database.collection(UPLOAD_TICKETS_COLLECTION).doc(id)
      await reference.update({ data: patch })
      return readDocument(reference)
    },

    async getWork(id) {
      return readDocument(database.collection(WORKS_COLLECTION).doc(id))
    },

    async getOwnedWork(id, openid) {
      const work = await this.getWork(id)
      return work?.openid === openid && !work.deletedAt ? work : null
    },

    async createProcessingWork(work, uploadTicketId, openid) {
      return database.runTransaction(async (transaction) => {
        const workRef = transaction.collection(WORKS_COLLECTION).doc(work.id)
        const existing = await readDocument(workRef)
        if (existing) return { created: false, work: existing }

        if (work.sourceWorkId) {
          const sourceRef = transaction.collection(WORKS_COLLECTION).doc(work.sourceWorkId)
          const sourceWork = await readDocument(sourceRef)
          const createdAt = Date.parse(work.createdAt)
          const sameSubject = sourceWork?.subjectFileId === work.subjectFileId
            && Boolean(sourceWork?.subjectFileId)
            && Date.parse(sourceWork?.subjectExpiresAt || '') > createdAt
          const sameOriginal = sourceWork?.sourceFileId === work.sourceFileId
            && Boolean(sourceWork?.sourceFileId)
            && Date.parse(sourceWork?.sourceExpiresAt || '') > createdAt
          if (!sourceWork || sourceWork.openid !== openid || sourceWork.deletedAt) {
            throw new ServiceError('NOT_FOUND')
          }
          if (!sameSubject && !sameOriginal) throw new ServiceError('SUBJECT_EXPIRED')
        } else {
          const ticketRef = transaction.collection(UPLOAD_TICKETS_COLLECTION).doc(uploadTicketId)
          const ticket = await readDocument(ticketRef)
          const createdAt = Date.parse(work.createdAt)
          const expectedSubjectPath = ticket
            ? `uploads/${ticket.id}/${ticket.requestId}/subject.png`
            : ''
          if (
            !ticket ||
            ticket.openid !== openid ||
            ticket.requestId !== work.requestId ||
            ticket.status !== 'issued' ||
            Date.parse(ticket.expiresAt) <= createdAt ||
            ticket.cloudPath !== pathFromCloudFileId(work.sourceFileId) ||
            (ticket.sourceFileId && ticket.sourceFileId !== work.sourceFileId) ||
            !ticket.subjectFileId?.startsWith('cloud://') ||
            pathFromCloudFileId(ticket.subjectFileId) !== expectedSubjectPath ||
            Date.parse(ticket.sourceExpiresAt || '') <= createdAt ||
            Date.parse(ticket.subjectExpiresAt || '') <= createdAt ||
            ticket.subjectFileId !== work.subjectFileId ||
            ticket.subjectExpiresAt !== work.subjectExpiresAt
          ) {
            throw new ServiceError('UPLOAD_TICKET_INVALID')
          }

          await ticketRef.update({
            data: {
              status: 'consumed',
              workId: work.id,
              consumedAt: work.createdAt,
              openid: null,
              requestId: null,
              imageType: null,
              cloudPath: null,
              sourceFileId: null,
              sourceExpiresAt: null,
              subjectFileId: null,
              subjectWidth: null,
              subjectHeight: null,
              subjectExpiresAt: null,
              preparedAt: null,
              expiresAt: null,
            },
          })
        }

        await workRef.set({ data: work })
        return { created: true, work }
      })
    },

    async updateWork(id, patch) {
      const reference = database.collection(WORKS_COLLECTION).doc(id)
      await reference.update({ data: patch })
      return readDocument(reference)
    },

    async listOwnedWorks(openid, limit = 50) {
      const result = await database
        .collection(WORKS_COLLECTION)
        .where({ openid, deletedAt: database.command.exists(false) })
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get()
      return result?.data || []
    },

    async deleteWork(id, patch) {
      await database.collection(WORKS_COLLECTION).doc(id).update({ data: patch })
    },

    async addEvent(event) {
      await database.collection(EVENTS_COLLECTION).add({ data: event })
    },

    async addEvents(events) {
      for (const event of events) {
        await database.collection(EVENTS_COLLECTION).add({ data: event })
      }
    },
  }
}

module.exports = { createRepository }
