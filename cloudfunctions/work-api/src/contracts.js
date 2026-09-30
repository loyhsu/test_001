const TEMPLATE_IDS = new Set([
  'pat-head',
  'shake-head',
  'slap',
  'kiss',
  'cry',
  'speechless',
])

const FAILURE_CODES = new Set([
  'INVALID_IMAGE',
  'IMAGE_TOO_LARGE',
  'IMAGE_TOO_SMALL',
  'MODERATION_REJECTED',
  'SUBJECT_NOT_FOUND',
  'MATTING_FAILED',
  'ENCODING_FAILED',
  'NETWORK_ERROR',
  'SUBJECT_EXPIRED',
])

const EVENT_FIELDS = {
  home_view: ['sessionId'],
  template_view: ['templateId'],
  photo_select_start: ['templateId'],
  photo_select_success: ['templateId', 'sizeKb'],
  editor_view: ['templateId'],
  generation_start: ['templateId', 'workId'],
  generation_success: ['templateId', 'durationMs', 'outputKb'],
  generation_fail: ['templateId', 'failureCode'],
  work_save_success: ['workId'],
  work_share_tap: ['workId', 'templateId'],
  create_again_tap: ['workId', 'nextTemplateId'],
}

class ServiceError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ServiceError'
    this.code = code
  }
}

function isServiceError(error) {
  return error instanceof ServiceError
}

function publicWork(work, options = {}) {
  if (!work) return undefined
  const { includeResultUrl = false, includeCoverUrl = false, now = Date.now() } = options
  const expired = Date.parse(work.expiresAt) <= now
  const result = {
    id: work.id,
    templateId: work.templateId,
    status: expired ? 'expired' : work.status,
    editorState: work.editorState,
    createdAt: work.createdAt,
    expiresAt: work.expiresAt,
  }

  if (work.failureCode) result.failureCode = work.failureCode
  if (Number.isFinite(work.outputBytes) && work.outputBytes > 0) {
    result.outputKb = Math.ceil(work.outputBytes / 1024)
  }
  if (!expired && includeCoverUrl && work.coverUrl) result.coverUrl = work.coverUrl
  if (!expired && includeResultUrl && work.resultUrl) result.resultUrl = work.resultUrl
  return result
}

function normalizeFailureCode(error) {
  return isServiceError(error) && FAILURE_CODES.has(error.code)
    ? error.code
    : 'NETWORK_ERROR'
}

module.exports = {
  EVENT_FIELDS,
  FAILURE_CODES,
  ServiceError,
  TEMPLATE_IDS,
  isServiceError,
  normalizeFailureCode,
  publicWork,
}
