import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildFrontendBackgroundPresets,
  validateBackgroundPresets,
  validateCatalog,
} from './validate-templates.mjs'
import { readFileSync } from 'node:fs'

const validManifest = {
  id: 'pat-head',
  name: '摸头',
  category: 'interaction',
  durationMs: 2400,
  fps: 15,
  canvas: { width: 480, height: 480 },
  subject: {
    defaultX: 240,
    defaultY: 278,
    defaultScale: 1,
    minScale: 0.65,
    maxScale: 1.6,
  },
  layers: [
    { type: 'background', asset: 'background.png' },
    { type: 'subject' },
    { type: 'animation', asset: 'foreground.webm' },
  ],
}

test('rejects duplicate template ids', () => {
  assert.throws(
    () => validateCatalog(['pat-head', 'pat-head'], [validManifest, validManifest]),
    /duplicate template id: pat-head/,
  )
})

test('rejects unknown layer types', () => {
  const invalid = {
    ...validManifest,
    layers: validManifest.layers.map((layer, index) =>
      index === 2 ? { type: 'sparkle', asset: 'sparkle.png' } : layer,
    ),
  }

  assert.throws(
    () => validateCatalog(['pat-head'], [invalid]),
    /unknown layer type: sparkle/,
  )
})

test('rejects invalid rendering bounds', () => {
  const cases = [
    [{ ...validManifest, canvas: { width: 320, height: 480 } }, /invalid canvas/],
    [{ ...validManifest, fps: 21 }, /fps must be between 10 and 20/],
    [{ ...validManifest, durationMs: 1199 }, /durationMs must be between 1200 and 4000/],
  ]

  for (const [manifest, expectedMessage] of cases) {
    assert.throws(
      () => validateCatalog(['pat-head'], [manifest]),
      expectedMessage,
    )
  }
})

test('rejects missing assets in strict mode', () => {
  assert.throws(
    () => validateCatalog(['pat-head'], [validManifest], {
      requireAssets: true,
      templateRoot: '/missing-expression-workshop-assets',
    }),
    /missing asset:/,
  )
})

test('rejects duplicate ids and invalid colors in background presets', () => {
  assert.throws(
    () => validateBackgroundPresets([
      { id: 'template', label: '模板原背景', color: null },
      { id: 'sky-blue', label: '浅蓝', color: '#DCEEFF' },
      { id: 'sky-blue', label: '重复', color: '#DCEEFF' },
    ]),
    /duplicate background preset id: sky-blue/,
  )
  assert.throws(
    () => validateBackgroundPresets([
      { id: 'template', label: '模板原背景', color: null },
      { id: 'sky-blue', label: '浅蓝', color: 'blue' },
    ]),
    /invalid background preset color: sky-blue/,
  )
})

test('builds the client background choices from the shared preset config', () => {
  const config = JSON.parse(readFileSync(
    new URL('../templates/pat-head/background-presets.json', import.meta.url),
    'utf8',
  ))

  const generated = buildFrontendBackgroundPresets(config.presets)

  assert.match(generated, /id: 'template', label: '模板原背景', color: null/)
  assert.match(generated, /id: 'sky-blue', label: '浅蓝', color: '#DCEEFF'/)
  assert.match(generated, /id: 'cream', label: '奶油杏', color: '#FFF0DC'/)
  assert.match(generated, /id: 'lavender', label: '淡紫', color: '#EFEAFF'/)
})
