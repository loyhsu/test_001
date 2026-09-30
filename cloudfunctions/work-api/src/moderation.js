const { ServiceError } = require('./contracts')

const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_PIXELS = 25_000_000
const MAX_MODERATION_BYTES = 1024 * 1024
const MIN_SHORT_EDGE = 320

const IMAGE_FORMATS = new Set(['jpeg', 'png'])
const IMAGE_TYPE_ALIASES = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png' }

function normalizeImageType(value) {
  const type = String(value || '').toLowerCase().replace(/^image\//, '')
  return IMAGE_TYPE_ALIASES[type] || ''
}

function isRejectedByWeChat(errorOrResult) {
  const rawCode = errorOrResult?.errCode ?? errorOrResult?.errcode ?? errorOrResult?.code
  return Number(rawCode) === 87014 || Number(rawCode) === -87014
}

function safeUpstreamCode(errorOrResult) {
  const rawCode = errorOrResult?.errCode ?? errorOrResult?.errcode ?? errorOrResult?.code
  const code = typeof rawCode === 'number' && Number.isInteger(rawCode)
    ? String(rawCode)
    : typeof rawCode === 'string' ? rawCode : ''
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : 'UNKNOWN'
}

function logModerationFailure(logger, errorOrResult) {
  try {
    logger?.error?.({
      action: 'moderation-openapi-failed',
      code: safeUpstreamCode(errorOrResult),
    })
  } catch {
    // Diagnostic logging must not change moderation behavior.
  }
}

async function makeModerationJpeg(sharp, source) {
  const sizes = [
    { width: 750, height: 1334, quality: 80 },
    { width: 750, height: 1334, quality: 60 },
    { width: 640, height: 1138, quality: 50 },
    { width: 512, height: 910, quality: 40 },
  ]

  for (const size of sizes) {
    const jpeg = await sharp(source, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize(size.width, size.height, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: size.quality })
      .toBuffer()
    if (jpeg.length <= MAX_MODERATION_BYTES) return jpeg
  }

  throw new ServiceError('IMAGE_TOO_LARGE')
}

function createModerator(cloud, sharp, logger) {
  return async function moderateSourceImage(source, expectedType) {
    if (!Buffer.isBuffer(source) || source.length === 0) {
      throw new ServiceError('INVALID_IMAGE')
    }
    if (source.length > MAX_SOURCE_BYTES) throw new ServiceError('IMAGE_TOO_LARGE')

    let metadata
    try {
      metadata = await sharp(source, { limitInputPixels: MAX_PIXELS }).metadata()
    } catch {
      throw new ServiceError('INVALID_IMAGE')
    }

    const actualType = normalizeImageType(metadata.format)
    if (!IMAGE_FORMATS.has(actualType) || actualType !== normalizeImageType(expectedType)) {
      throw new ServiceError('INVALID_IMAGE')
    }
    if (!metadata.width || !metadata.height) throw new ServiceError('INVALID_IMAGE')
    if (Math.min(metadata.width, metadata.height) < MIN_SHORT_EDGE) {
      throw new ServiceError('IMAGE_TOO_SMALL')
    }

    let jpeg
    try {
      jpeg = await makeModerationJpeg(sharp, source)
    } catch (error) {
      if (error instanceof ServiceError) throw error
      throw new ServiceError('INVALID_IMAGE')
    }
    let result
    try {
      result = await cloud.openapi.security.imgSecCheck({
        media: { contentType: 'image/jpeg', value: jpeg },
      })
    } catch (error) {
      if (isRejectedByWeChat(error)) throw new ServiceError('MODERATION_REJECTED')
      logModerationFailure(logger, error)
      const failure = new ServiceError('NETWORK_ERROR')
      failure.diagnosticCode = safeUpstreamCode(error)
      throw failure
    }

    const errorCode = Number(result?.errCode ?? result?.errcode ?? 0)
    if (errorCode === 87014 || errorCode === -87014) {
      throw new ServiceError('MODERATION_REJECTED')
    }
    if (errorCode !== 0) {
      logModerationFailure(logger, result)
      const failure = new ServiceError('NETWORK_ERROR')
      failure.diagnosticCode = safeUpstreamCode(result)
      throw failure
    }
  }
}

module.exports = { createModerator }
