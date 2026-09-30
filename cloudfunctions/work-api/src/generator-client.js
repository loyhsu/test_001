const { FAILURE_CODES, ServiceError } = require('./contracts')

const OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024
const CONTAINER_TIMEOUT_MS = 110000

function safeDiagnosticValue(value) {
  const text = typeof value === 'number' && Number.isInteger(value)
    ? String(value)
    : typeof value === 'string' ? value : ''
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(text) ? text : undefined
}

function networkError(diagnosticCode) {
  const error = new ServiceError('NETWORK_ERROR')
  error.diagnosticCode = diagnosticCode
  return error
}

function validateGeneratorResult(result) {
  if (
    !result ||
    typeof result.resultFileId !== 'string' ||
    !result.resultFileId.startsWith('cloud://') ||
    typeof result.coverFileId !== 'string' ||
    !result.coverFileId.startsWith('cloud://') ||
    typeof result.subjectFileId !== 'string' ||
    !result.subjectFileId.startsWith('cloud://') ||
    !Number.isInteger(result.outputBytes) ||
    result.outputBytes <= 0 ||
    result.outputBytes > OUTPUT_LIMIT_BYTES
  ) {
    throw new ServiceError('ENCODING_FAILED')
  }
  return {
    resultFileId: result.resultFileId,
    coverFileId: result.coverFileId,
    subjectFileId: result.subjectFileId,
    outputBytes: result.outputBytes,
  }
}

function validatePreparedSubject(result) {
  if (
    !result ||
    typeof result.subjectFileId !== 'string' ||
    !result.subjectFileId.startsWith('cloud://') ||
    !Number.isInteger(result.width) || result.width <= 0 ||
    !Number.isInteger(result.height) || result.height <= 0
  ) {
    throw new ServiceError('ENCODING_FAILED')
  }
  return {
    subjectFileId: result.subjectFileId,
    width: result.width,
    height: result.height,
  }
}

function createGeneratorClient({ serviceName, token, callContainerImpl, logger }) {
  async function post(path, input, validate) {
    if (!serviceName || !token || typeof callContainerImpl !== 'function') {
      throw networkError('CONFIG_MISSING')
    }

    let response
    try {
      response = await callContainerImpl({
        name: serviceName,
        method: 'POST',
        path: `/v1/${path}`,
        header: {
          'X-Generator-Token': token,
          'content-type': 'application/json',
        },
        data: input,
      }, { timeout: CONTAINER_TIMEOUT_MS })
    } catch (error) {
      const diagnostic = {
        action: 'generator-call-failed',
        path: path.replace(/^\/v1\//, ''),
      }
      const upstreamCode = safeDiagnosticValue(error?.code)
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : undefined
      const requestId = safeDiagnosticValue(error?.requestId)
      if (upstreamCode) diagnostic.upstreamCode = upstreamCode
      if (statusCode) diagnostic.statusCode = statusCode
      if (requestId) diagnostic.requestId = requestId
      try {
        logger?.error?.(diagnostic)
      } catch {
        // Diagnostics must not replace the stable public error.
      }
      throw networkError(upstreamCode || (statusCode ? `HTTP_${statusCode}` : 'CONTAINER_CALL_FAILED'))
    }

    if (!response || !Number.isInteger(response.statusCode) || !response.data) {
      throw networkError('INVALID_RESPONSE')
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const body = response.data
      const code = body?.error?.code ?? body?.failureCode
      if (!FAILURE_CODES.has(code)) throw networkError(`HTTP_${response.statusCode}`)
      throw new ServiceError(code)
    }
    return validate(response.data)
  }

  return {
    generateWork: (input) => post('generate', input, validateGeneratorResult),
    prepareSubject: (input) => post('prepare-subject', input, validatePreparedSubject),
  }
}

module.exports = { createGeneratorClient, validatePreparedSubject }
