import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const allowedLayerTypes = new Set(['background', 'subject', 'animation'])
const allowedCategories = new Set(['popular', 'funny', 'interaction', 'emotion'])
const backgroundColorPattern = /^#[\da-f]{6}$/i
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const rootDirectory = resolve(scriptDirectory, '..')

export function validateBackgroundPresets(presets) {
  if (!Array.isArray(presets) || presets.length < 2) {
    throw new Error('background presets must contain template and color choices')
  }

  const seen = new Set()
  for (const preset of presets) {
    if (!preset || typeof preset.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(preset.id)) {
      throw new Error('invalid background preset id')
    }
    if (seen.has(preset.id)) throw new Error(`duplicate background preset id: ${preset.id}`)
    seen.add(preset.id)
    if (typeof preset.label !== 'string' || !preset.label.trim()) {
      throw new Error(`invalid background preset label: ${preset.id}`)
    }
    if (preset.id === 'template') {
      if (preset.color !== null) throw new Error('template background preset color must be null')
    } else if (typeof preset.color !== 'string' || !backgroundColorPattern.test(preset.color)) {
      throw new Error(`invalid background preset color: ${preset.id}`)
    }
  }

  if (!seen.has('template')) throw new Error('background presets require template id')
  return presets
}

function quoteTypeScript(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

export function buildFrontendBackgroundPresets(presets) {
  validateBackgroundPresets(presets)
  const records = presets.map(({ id, label, color }) =>
    `  { id: ${quoteTypeScript(id)}, label: ${quoteTypeScript(label)}, color: ${color === null ? 'null' : quoteTypeScript(color)} },`,
  )
  return [
    'export const BACKGROUND_PRESETS = [',
    ...records,
    '] as const',
    '',
    "export type BackgroundPresetId = (typeof BACKGROUND_PRESETS)[number]['id']",
    '',
  ].join('\n')
}

function assertNumberInRange(value, min, max, label) {
  if (typeof value !== 'number' || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`)
  }
}

export function validateCatalog(templateIds, manifests, options = {}) {
  const duplicate = templateIds.find((id, index) => templateIds.indexOf(id) !== index)
  if (duplicate) throw new Error(`duplicate template id: ${duplicate}`)
  if (templateIds.length !== manifests.length) {
    throw new Error('catalog and manifest count differ')
  }

  manifests.forEach((manifest, index) => {
    const expectedId = templateIds[index]
    if (manifest.id !== expectedId) {
      throw new Error(`manifest id mismatch: ${expectedId} != ${manifest.id}`)
    }
    if (!manifest.name || !allowedCategories.has(manifest.category)) {
      throw new Error(`invalid metadata for template: ${manifest.id}`)
    }
    assertNumberInRange(manifest.durationMs, 1200, 4000, `${manifest.id}.durationMs`)
    assertNumberInRange(manifest.fps, 10, 20, `${manifest.id}.fps`)
    if (manifest.canvas?.width !== 480 || manifest.canvas?.height !== 480) {
      throw new Error(`invalid canvas for template: ${manifest.id}`)
    }
    assertNumberInRange(manifest.subject?.defaultX, 0, 480, `${manifest.id}.defaultX`)
    assertNumberInRange(manifest.subject?.defaultY, 0, 480, `${manifest.id}.defaultY`)
    assertNumberInRange(manifest.subject?.defaultScale, 0.65, 1.6, `${manifest.id}.defaultScale`)
    if (manifest.subject?.minScale !== 0.65 || manifest.subject?.maxScale !== 1.6) {
      throw new Error(`invalid scale limits for template: ${manifest.id}`)
    }
    if (!Array.isArray(manifest.layers) || manifest.layers.length < 3) {
      throw new Error(`template requires at least three layers: ${manifest.id}`)
    }
    manifest.layers.forEach((layer) => {
      if (!allowedLayerTypes.has(layer.type)) {
        throw new Error(`unknown layer type: ${layer.type}`)
      }
      if (layer.type === 'subject' && layer.asset) {
        throw new Error(`subject layer cannot define an asset: ${manifest.id}`)
      }
      if (layer.type !== 'subject' && !layer.asset) {
        throw new Error(`${layer.type} layer requires an asset: ${manifest.id}`)
      }
      if (options.requireAssets && layer.asset) {
        const assetPath = resolve(options.templateRoot, manifest.id, layer.asset)
        if (!existsSync(assetPath)) throw new Error(`missing asset: ${assetPath}`)
      }
    })

    if (options.requireAssets) {
      for (const fileName of ['cover.png', 'preview.gif']) {
        const assetPath = resolve(options.templateRoot, manifest.id, fileName)
        if (!existsSync(assetPath)) throw new Error(`missing asset: ${assetPath}`)
      }
    }
  })

  return manifests
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function generateFrontendCatalog(manifests) {
  const records = manifests.map((manifest, index) => ({
    id: manifest.id,
    name: manifest.name,
    category: manifest.category,
    previewUrl: `/templates/${manifest.id}/preview.gif`,
    coverUrl: `/templates/${manifest.id}/cover.png`,
    sortOrder: index,
    enabled: true,
  }))
  const output = [
    "import type { Template } from '../domain/contracts'",
    '',
    `export const TEMPLATE_CATALOG: Template[] = ${JSON.stringify(records, null, 2)}`,
    '',
  ].join('\n')
  writeFileSync(
    resolve(rootDirectory, 'apps/miniprogram/src/generated/template-catalog.ts'),
    output,
  )
}

function generateFrontendBackgroundCatalog(presets) {
  writeFileSync(
    resolve(rootDirectory, 'apps/miniprogram/src/generated/background-presets.ts'),
    buildFrontendBackgroundPresets(presets),
  )
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const templateRoot = resolve(rootDirectory, 'templates')
  const { templateIds } = readJson(resolve(templateRoot, 'catalog.json'))
  const manifests = templateIds.map((id) => readJson(resolve(templateRoot, id, 'manifest.json')))
  const backgroundPresets = readJson(
    resolve(templateRoot, 'pat-head', 'background-presets.json'),
  ).presets
  validateCatalog(templateIds, manifests, {
    requireAssets: process.argv.includes('--require-assets'),
    templateRoot,
  })
  validateBackgroundPresets(backgroundPresets)
  generateFrontendCatalog(manifests)
  generateFrontendBackgroundCatalog(backgroundPresets)
  console.log(`Validated ${manifests.length} templates`)
}
