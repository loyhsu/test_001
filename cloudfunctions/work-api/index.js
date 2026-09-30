const cloud = require('wx-server-sdk')
const cloudbaseSdk = require('@cloudbase/node-sdk')
const sharp = require('sharp')

const { createGeneratorClient } = require('./src/generator-client')
const { createModerator } = require('./src/moderation')
const { createRepository } = require('./src/repository')
const { createRouter } = require('./src/router')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const repository = createRepository(cloud.database())
const routerDependencies = {
  repository,
  moderate: createModerator(cloud, sharp, cloud.logger()),
  downloadSource: async (fileID) => {
    const result = await cloud.downloadFile({ fileID })
    return result.fileContent
  },
  getTemporaryFileUrls: async (fileIDs) => {
    if (fileIDs.length === 0) return new Map()
    const result = await cloud.getTempFileURL({
      fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 3600 })),
    })
    return new Map(
      (result.fileList || [])
        .filter((item) => item.tempFileURL)
        .map((item) => [item.fileID, item.tempFileURL]),
    )
  },
  deleteFiles: async (fileIDs) => {
    if (fileIDs.length === 0) return
    const result = await cloud.deleteFile({ fileList: fileIDs })
    const failed = (result.fileList || []).filter(
      (item) => item.status !== 0 && !/not exist|not found/i.test(item.errMsg || ''),
    )
    if (failed.length > 0) throw new Error('storage delete failed')
  },
  createId: () => require('crypto').randomUUID(),
  now: () => new Date(),
  logger: cloud.logger(),
}

exports.main = async (event = {}, context = {}) => {
  const { OPENID, ENV } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: { code: 'UNAUTHENTICATED' } }
  const cloudbaseApp = cloudbaseSdk.init({ env: ENV || cloudbaseSdk.SYMBOL_CURRENT_ENV, context })
  const generator = createGeneratorClient({
    serviceName: process.env.GENERATOR_SERVICE_NAME || 'generator',
    token: process.env.GENERATOR_TOKEN,
    callContainerImpl: cloudbaseApp.callContainer.bind(cloudbaseApp),
    logger: routerDependencies.logger,
  })
  const router = createRouter({
    ...routerDependencies,
    generate: generator.generateWork,
    prepareSubject: generator.prepareSubject,
  })
  return router.dispatch(event.action, event.payload, OPENID)
}
