# Expression Workshop MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free WeChat Mini Program MVP that turns one user-selected photo into one of six template-based animated GIF expressions, then lets the user save, share, revisit, or create another work.

**Architecture:** A Taro 4 React/TypeScript Mini Program owns browsing, upload, editing, result, and history UX. A CloudBase Node cloud function supplies trusted WeChat identity, moderation, work persistence, and calls a Python/FastAPI media worker deployed in CloudBase Run; the worker performs matting, template composition, GIF encoding, and output upload. Template definitions live in one repository-level catalog consumed and validated by both runtimes.

**Tech Stack:** Taro 4.x, React, TypeScript, pnpm, Vitest, CloudBase, `wx-server-sdk`, Python 3.11, FastAPI, Pytest, Pillow, rembg, FFmpeg, JSON Schema.

**Spec:** `docs/product/expression-workshop-mvp-v1.md`

## Global Constraints

- Do not implement membership, payment, orders, refunds, coupons, invoices, ads, paywalls, or paid copy.
- v1.0 contains exactly six expression templates: `pat-head`, `shake-head`, `slap`, `kiss`, `cry`, `speechless`.
- The four general-purpose GIF tools belong to v1.1 and are not implemented by this plan.
- Ship only WeChat Mini Program output; do not add H5 or other mini-program targets.
- Use Node.js 22.x and keep Taro CLI and all `@tarojs/*` package versions exactly aligned, following the Taro 4.x requirement.
- Use Python 3.11 for the media worker.
- Accept one JPG/JPEG/PNG image up to 10 MB with a minimum short edge of 320 px.
- Generate a 480 × 480 GIF no larger than 8 MB plus a static cover image.
- Original uploads and reusable subject cutouts expire after 24 hours; generated work expires after 30 days.
- Never trust an `openid` sent by the client; read identity from `cloud.getWXContext()`.
- Keep originals, cutouts, and generated files private; client-visible URLs must be temporary.
- Every generated work is idempotent by `requestId`; repeated taps return the same work rather than creating duplicates.

## Review Focus

- Unsupported, corrupt, oversized, or too-small input must be rejected before processing and retain a clear retry path.
- Upload interruption must preserve selected template and editor state so the user can retry without starting over.
- Moderation, subject detection, matting, and GIF encoding failures must map to stable user-facing error codes instead of generic crashes.
- Repeated generate taps and retried requests with the same `requestId` must produce one work record and one result file.
- An expired or deleted result must remain visible in history as an expired record without a broken image URL.

---

### Task 1: Scaffold the two-runtime workspace and lock the contracts

**Files:**
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `apps/miniprogram/package.json`
- Create: `apps/miniprogram/config/index.ts`
- Create: `apps/miniprogram/src/app.ts`
- Create: `apps/miniprogram/src/app.config.ts`
- Create: `apps/miniprogram/src/app.scss`
- Create: `apps/miniprogram/src/domain/contracts.ts`
- Create: `apps/miniprogram/src/domain/contracts.test.ts`
- Create: `services/generator/pyproject.toml`
- Create: `services/generator/app/__init__.py`
- Create: `services/generator/app/models.py`
- Create: `services/generator/tests/test_models.py`

**Interfaces:**
- Consumes: Product constants from `docs/product/expression-workshop-mvp-v1.md`.
- Produces: TypeScript `Template`, `EditorState`, `Work`, `FailureCode`, and `GenerateWorkInput`; Python `GenerateRequest`, `GenerateResponse`, and `EditorState` with identical field names.

- [ ] **Step 1: Write failing TypeScript contract tests**

```ts
// apps/miniprogram/src/domain/contracts.test.ts
import { describe, expect, it } from 'vitest'
import { normalizeEditorState } from './contracts'

describe('normalizeEditorState', () => {
  it('clamps subject transform and allows only the three supported speeds', () => {
    expect(normalizeEditorState({ x: 999, y: -20, scale: 3, speed: 'turbo' as never }))
      .toEqual({ x: 480, y: 0, scale: 1.6, speed: 'standard' })
  })
})
```

- [ ] **Step 2: Run the TypeScript test and verify the contract is missing**

Run: `pnpm --dir apps/miniprogram vitest run src/domain/contracts.test.ts`  
Expected: FAIL because `contracts.ts` and `normalizeEditorState` do not exist.

- [ ] **Step 3: Implement the shared TypeScript vocabulary**

```ts
// apps/miniprogram/src/domain/contracts.ts
export type Speed = 'slow' | 'standard' | 'fast'
export type WorkStatus = 'processing' | 'ready' | 'failed' | 'expired'
export type FailureCode =
  | 'INVALID_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_TOO_SMALL'
  | 'MODERATION_REJECTED'
  | 'SUBJECT_NOT_FOUND'
  | 'MATTING_FAILED'
  | 'ENCODING_FAILED'
  | 'NETWORK_ERROR'

export interface EditorState { x: number; y: number; scale: number; speed: Speed }
export interface Template {
  id: string
  name: string
  category: 'popular' | 'funny' | 'interaction' | 'emotion'
  previewUrl: string
  coverUrl: string
  sortOrder: number
  enabled: boolean
}
export interface Work {
  id: string
  templateId: string
  status: WorkStatus
  coverUrl?: string
  resultUrl?: string
  failureCode?: FailureCode
  editorState: EditorState
  createdAt: string
  expiresAt: string
}
export interface GenerateWorkInput {
  requestId: string
  templateId: string
  sourceFileId: string
  editorState: EditorState
}

const supportedSpeeds: Speed[] = ['slow', 'standard', 'fast']
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function normalizeEditorState(input: EditorState): EditorState {
  return {
    x: clamp(input.x, 0, 480),
    y: clamp(input.y, 0, 480),
    scale: clamp(input.scale, 0.65, 1.6),
    speed: supportedSpeeds.includes(input.speed) ? input.speed : 'standard',
  }
}
```

- [ ] **Step 4: Write and implement matching Python request validation**

```py
# services/generator/app/models.py
from typing import Literal
from pydantic import BaseModel, Field

Speed = Literal['slow', 'standard', 'fast']

class EditorState(BaseModel):
    x: float = Field(ge=0, le=480)
    y: float = Field(ge=0, le=480)
    scale: float = Field(ge=0.65, le=1.6)
    speed: Speed

class GenerateRequest(BaseModel):
    requestId: str = Field(min_length=8, max_length=64)
    workId: str = Field(min_length=8, max_length=64)
    templateId: str
    sourceUrl: str
    editorState: EditorState

class GenerateResponse(BaseModel):
    resultFileId: str
    coverFileId: str
    outputBytes: int = Field(gt=0, le=8_388_608)
```

```py
# services/generator/tests/test_models.py
import pytest
from pydantic import ValidationError
from app.models import GenerateRequest

def test_rejects_scale_above_template_limit():
    with pytest.raises(ValidationError):
        GenerateRequest(
            requestId='request-123', workId='work-123', templateId='pat-head',
            sourceUrl='https://example.test/source.png',
            editorState={'x': 240, 'y': 240, 'scale': 2, 'speed': 'standard'},
        )
```

- [ ] **Step 5: Add workspace scripts and run both suites**

Root scripts must expose `test:web`, `test:generator`, `test`, `dev:weapp`, and `build:weapp`. Pin Node with `.nvmrc` containing `22` and Python with `requires-python = ">=3.11,<3.12"`.

Run: `pnpm test && cd services/generator && python3.11 -m pytest -q`  
Expected: both suites PASS.

- [ ] **Step 6: Commit the scaffold**

```bash
git add .nvmrc .gitignore package.json pnpm-workspace.yaml apps/miniprogram services/generator
git commit -m "chore: scaffold expression workshop mvp"
```

### Task 2: Create the validated six-template catalog

**Files:**
- Create: `templates/schema.json`
- Create: `templates/catalog.json`
- Create: `templates/pat-head/manifest.json`
- Create: `templates/shake-head/manifest.json`
- Create: `templates/slap/manifest.json`
- Create: `templates/kiss/manifest.json`
- Create: `templates/cry/manifest.json`
- Create: `templates/speechless/manifest.json`
- Create: `scripts/validate-templates.mjs`
- Create: `apps/miniprogram/src/generated/template-catalog.ts`
- Create: `services/generator/app/template_catalog.py`
- Create: `services/generator/tests/test_template_catalog.py`

**Interfaces:**
- Consumes: `Template` from Task 1.
- Produces: `getTemplate(id: string): TemplateManifest` in Python and `TEMPLATE_CATALOG: Template[]` in TypeScript.

- [ ] **Step 1: Write a failing catalog validation test**

```py
# services/generator/tests/test_template_catalog.py
from app.template_catalog import load_catalog

def test_catalog_contains_exactly_the_six_mvp_templates():
    catalog = load_catalog()
    assert [item.id for item in catalog] == [
        'pat-head', 'shake-head', 'slap', 'kiss', 'cry', 'speechless'
    ]
    assert all(item.canvas.width == 480 and item.canvas.height == 480 for item in catalog)
```

- [ ] **Step 2: Run the test and verify the loader is absent**

Run: `cd services/generator && python3.11 -m pytest tests/test_template_catalog.py -q`  
Expected: FAIL with `ModuleNotFoundError: app.template_catalog`.

- [ ] **Step 3: Define the JSON schema and six manifests**

Each manifest must contain `id`, `name`, `category`, `durationMs`, `fps`, `canvas`, `subject`, and ordered `layers`. Use the exact `pat-head` example in the spec; the other five manifests use the same 480 × 480 canvas and only change timing, subject defaults, and asset names. Every manifest must reference these local files:

```text
cover.png
preview.gif
background.png
foreground.webm
```

The template validator must fail on an unknown layer type, duplicate ID, missing asset, canvas other than 480 × 480, FPS outside 10–20, or duration outside 1200–4000 ms.

- [ ] **Step 4: Implement both catalog readers from the repository catalog**

```py
# services/generator/app/template_catalog.py
import json
from functools import lru_cache
from pathlib import Path
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[3]

class Canvas(BaseModel):
    width: int
    height: int

class Manifest(BaseModel):
    id: str
    name: str
    category: str
    durationMs: int
    fps: int
    canvas: Canvas
    subject: dict
    layers: list[dict]

@lru_cache
def load_catalog() -> list[Manifest]:
    ids = json.loads((ROOT / 'templates/catalog.json').read_text())['templateIds']
    return [Manifest.model_validate_json(
        (ROOT / 'templates' / template_id / 'manifest.json').read_text()
    ) for template_id in ids]

def get_template(template_id: str) -> Manifest:
    return next(item for item in load_catalog() if item.id == template_id)
```

- [ ] **Step 5: Validate and generate the frontend catalog**

Run: `node scripts/validate-templates.mjs`  
Expected: `Validated 6 templates` and `apps/miniprogram/src/generated/template-catalog.ts` contains six enabled items in catalog order.

- [ ] **Step 6: Run catalog tests and commit**

Run: `pnpm test && cd services/generator && python3.11 -m pytest -q`  
Expected: PASS.

```bash
git add templates scripts apps/miniprogram/src/generated services/generator/app/template_catalog.py services/generator/tests/test_template_catalog.py
git commit -m "feat: define validated expression templates"
```

### Task 3: Build browsing, photo selection, and deterministic editor state

**Files:**
- Modify: `apps/miniprogram/src/app.config.ts`
- Create: `apps/miniprogram/src/pages/home/index.tsx`
- Create: `apps/miniprogram/src/pages/home/index.scss`
- Create: `apps/miniprogram/src/pages/templates/index.tsx`
- Create: `apps/miniprogram/src/pages/templates/index.scss`
- Create: `apps/miniprogram/src/pages/template-detail/index.tsx`
- Create: `apps/miniprogram/src/pages/template-detail/index.scss`
- Create: `apps/miniprogram/src/pages/editor/index.tsx`
- Create: `apps/miniprogram/src/pages/editor/index.scss`
- Create: `apps/miniprogram/src/features/editor/editor-state.ts`
- Create: `apps/miniprogram/src/features/editor/editor-state.test.ts`
- Create: `apps/miniprogram/src/platform/media.ts`
- Create: `apps/miniprogram/src/components/template-card/index.tsx`

**Interfaces:**
- Consumes: `TEMPLATE_CATALOG`, `EditorState`, and `normalizeEditorState`.
- Produces: `chooseSourceImage(): Promise<SelectedImage>` and pure `editorReducer(state, action): EditorState`.

- [ ] **Step 1: Write failing editor reducer tests**

```ts
// apps/miniprogram/src/features/editor/editor-state.test.ts
import { describe, expect, it } from 'vitest'
import { editorReducer, initialEditorState } from './editor-state'

describe('editorReducer', () => {
  it('clamps drag and scale to the supported canvas range', () => {
    const moved = editorReducer(initialEditorState, { type: 'move', x: -30, y: 520 })
    const scaled = editorReducer(moved, { type: 'scale', scale: 2 })
    expect(scaled).toEqual({ x: 0, y: 480, scale: 1.6, speed: 'standard' })
  })

  it('resets transform when the source image changes', () => {
    const changed = editorReducer(
      { x: 12, y: 30, scale: 1.4, speed: 'fast' },
      { type: 'replace-source' },
    )
    expect(changed).toEqual(initialEditorState)
  })
})
```

- [ ] **Step 2: Run the reducer test and verify failure**

Run: `pnpm --dir apps/miniprogram vitest run src/features/editor/editor-state.test.ts`  
Expected: FAIL because the reducer is missing.

- [ ] **Step 3: Implement the reducer and media adapter**

`chooseSourceImage()` must call `wx.chooseMedia` with `count: 1`, `mediaType: ['image']`, and `sourceType: ['album']`, then reject files larger than 10 MB before navigation. Use `wx.getImageInfo` to reject a short edge below 320 px and file extensions outside JPG/JPEG/PNG.

```ts
export const initialEditorState = { x: 240, y: 240, scale: 1, speed: 'standard' } as const

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'replace-source') return { ...initialEditorState }
  if (action.type === 'move') return normalizeEditorState({ ...state, x: action.x, y: action.y })
  if (action.type === 'scale') return normalizeEditorState({ ...state, scale: action.scale })
  return normalizeEditorState({ ...state, speed: action.speed })
}
```

- [ ] **Step 4: Implement the four routes and route data**

Register `pages/home/index`, `pages/templates/index`, `pages/template-detail/index`, and `pages/editor/index`. Home renders one primary CTA and all six templates. Template library supports the four fixed categories. Template detail renders preview, photo guidance, and one CTA. Editor reads only `templateId` from route query; selected local file state is passed through a lightweight creation store, never encoded in the URL.

- [ ] **Step 5: Add UI state tests and compile the Mini Program**

Test category filtering, missing `templateId`, image validation messages, and reducer bounds as pure functions.

Run: `pnpm --dir apps/miniprogram test && pnpm --dir apps/miniprogram build:weapp`  
Expected: all tests PASS and `dist/` is generated without TypeScript errors.

- [ ] **Step 6: Commit the browse and editor shell**

```bash
git add apps/miniprogram/src
git commit -m "feat: add template browsing and editor shell"
```

### Task 4: Add the CloudBase work API, moderation gate, and idempotency

**Files:**
- Create: `cloudfunctions/work-api/package.json`
- Create: `cloudfunctions/work-api/config.json`
- Create: `cloudfunctions/work-api/index.ts`
- Create: `cloudfunctions/work-api/src/router.ts`
- Create: `cloudfunctions/work-api/src/contracts.ts`
- Create: `cloudfunctions/work-api/src/repository.ts`
- Create: `cloudfunctions/work-api/src/moderation.ts`
- Create: `cloudfunctions/work-api/src/generator-client.ts`
- Create: `cloudfunctions/work-api/src/router.test.ts`
- Create: `apps/miniprogram/src/services/work-api.ts`

**Interfaces:**
- Consumes: `GenerateWorkInput` and trusted `OPENID`.
- Produces: cloud actions `createWork`, `getWork`, `listWorks`, `deleteWork`, and `trackEvent`.

- [ ] **Step 1: Write failing API idempotency and identity tests**

```ts
// cloudfunctions/work-api/src/router.test.ts
import { describe, expect, it } from 'vitest'
import { createRouter } from './router'

it('returns the existing work for a repeated requestId', async () => {
  const repo = fakeRepoWithExisting({ requestId: 'request-123', openid: 'trusted-openid', id: 'work-1' })
  const router = createRouter({ repo, moderate: allowImage, generate: neverCalled })
  const result = await router.createWork(validInput, 'trusted-openid')
  expect(result.id).toBe('work-1')
  expect(neverCalled).not.toHaveBeenCalled()
})

it('ignores an openid supplied in the client payload', async () => {
  const result = await router.createWork({ ...validInput, openid: 'forged' } as never, 'trusted-openid')
  expect(result.openid).toBe('trusted-openid')
})
```

- [ ] **Step 2: Run the tests and verify the router is missing**

Run: `pnpm --dir cloudfunctions/work-api vitest run`  
Expected: FAIL because the router and fakes do not exist.

- [ ] **Step 3: Implement the trusted cloud-function entry point**

```ts
// cloudfunctions/work-api/index.ts
import cloud from 'wx-server-sdk'
import { createRouter } from './src/router'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export async function main(event: { action: string; payload?: unknown }) {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: { code: 'UNAUTHENTICATED' } }
  return createRouter(createDependencies(cloud)).dispatch(event.action, event.payload, OPENID)
}
```

The client wrapper must expose typed methods and only call `wx.cloud.callFunction({ name: 'work-api', data: { action, payload } })`.

- [ ] **Step 4: Implement moderation before generator invocation**

Declare the exact CloudBase permissions:

```json
{
  "permissions": {
    "openapi": ["security.imgSecCheck"]
  }
}
```

Download the private source file inside the cloud function, create a moderation JPEG capped at 1 MB, and call `cloud.openapi.security.imgSecCheck`. Map a rejected image to `MODERATION_REJECTED`; do not call the generator or create a reusable subject file after rejection.

- [ ] **Step 5: Implement the work repository and generator call**

Create a unique index on `(openid, requestId)`. Insert status `processing`, invoke the media worker with a temporary source URL, then atomically update to `ready` with result IDs or `failed` with one stable `failureCode`. `listWorks` must return only the current user's records and convert elapsed `expiresAt` to `expired` without returning result URLs.

- [ ] **Step 6: Run API tests and commit**

Run: `pnpm --dir cloudfunctions/work-api test`  
Expected: tests cover trusted identity, idempotency, moderation rejection, generator failure mapping, expiry, and delete ownership; all PASS.

```bash
git add cloudfunctions apps/miniprogram/src/services/work-api.ts
git commit -m "feat: add secure cloud work api"
```

### Task 5: Implement the Python matting and template compositor service

**Files:**
- Create: `services/generator/app/main.py`
- Create: `services/generator/app/image_validation.py`
- Create: `services/generator/app/matting.py`
- Create: `services/generator/app/compositor.py`
- Create: `services/generator/app/storage.py`
- Create: `services/generator/app/errors.py`
- Create: `services/generator/tests/fixtures/source-person.png`
- Create: `services/generator/tests/fixtures/template-background.png`
- Create: `services/generator/tests/fixtures/template-foreground.webm`
- Create: `services/generator/tests/test_image_validation.py`
- Create: `services/generator/tests/test_compositor.py`
- Create: `services/generator/tests/test_api.py`
- Create: `services/generator/Dockerfile`

**Interfaces:**
- Consumes: `GenerateRequest` from Task 1 and template manifests from Task 2.
- Produces: `POST /v1/generate` returning `GenerateResponse`; errors use `INVALID_IMAGE`, `SUBJECT_NOT_FOUND`, `MATTING_FAILED`, or `ENCODING_FAILED`.

- [ ] **Step 1: Write failing image and compositor tests**

```py
def test_rejects_image_with_short_edge_below_320():
    with pytest.raises(GeneratorError, match='IMAGE_TOO_SMALL'):
        validate_image(make_image(319, 640))

def test_compositor_outputs_bounded_gif_and_cover(tmp_path):
    result = compose(
        source=fixture('source-person.png'),
        template_id='pat-head',
        editor_state=EditorState(x=240, y=278, scale=1, speed='standard'),
        output_dir=tmp_path,
    )
    assert result.gif.stat().st_size <= 8_388_608
    assert Image.open(result.cover).size == (480, 480)
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd services/generator && python3.11 -m pytest tests/test_image_validation.py tests/test_compositor.py -q`  
Expected: FAIL because validation and composition modules are missing.

- [ ] **Step 3: Implement deterministic input validation and matting**

Decode with Pillow, apply EXIF orientation, convert to RGBA, and reject decompression bombs, invalid MIME, short edge below 320 px, or decoded pixel count above 25 megapixels. `RembgMattingProvider.extract_subject(image)` must return transparent PNG bytes and raise `SUBJECT_NOT_FOUND` when the non-transparent subject bounds occupy less than 5% of the canvas.

- [ ] **Step 4: Implement frame composition and bounded encoding**

For each frame, apply speed multiplier (`slow=0.8`, `standard=1.0`, `fast=1.25`), subject transform, background, subject, and foreground layers. First encode at 480 px and 15 FPS; if output exceeds 8 MB, retry at 12 FPS, then 420 px. If still oversized, return `ENCODING_FAILED` rather than delivering an invalid file.

Use a per-request temporary directory created by `tempfile.TemporaryDirectory()` and never interpolate user input into shell commands. Invoke FFmpeg with an argument array and `check=True`.

- [ ] **Step 5: Implement the authenticated FastAPI route and storage adapter**

```py
# services/generator/app/main.py
from fastapi import FastAPI, Header, HTTPException
from .models import GenerateRequest, GenerateResponse

app = FastAPI()

@app.post('/v1/generate', response_model=GenerateResponse)
def generate(request: GenerateRequest, x_internal_token: str = Header()):
    if not constant_time_matches(x_internal_token, settings.internal_token):
        raise HTTPException(status_code=401, detail='UNAUTHENTICATED')
    return generate_and_store(request)
```

The internal token exists only in CloudBase function and container environment variables. Download only the one temporary source URL supplied by the trusted cloud function. Upload result and cover to private paths `works/{openidHash}/{workId}/result.gif` and `cover.jpg`.

- [ ] **Step 6: Run Python tests and build the container**

Run: `cd services/generator && python3.11 -m pytest -q`  
Expected: validation, matting failure, layer order, size fallback, auth, and cleanup tests PASS.

Run: `docker build -t expression-workshop-generator services/generator`  
Expected: image builds successfully and the health route returns 200.

- [ ] **Step 7: Commit the generator**

```bash
git add services/generator
git commit -m "feat: add expression media generator"
```

### Task 6: Connect generation UX, result actions, and work history

**Files:**
- Modify: `apps/miniprogram/src/pages/editor/index.tsx`
- Create: `apps/miniprogram/src/pages/processing/index.tsx`
- Create: `apps/miniprogram/src/pages/processing/index.scss`
- Create: `apps/miniprogram/src/pages/result/index.tsx`
- Create: `apps/miniprogram/src/pages/result/index.scss`
- Create: `apps/miniprogram/src/pages/works/index.tsx`
- Create: `apps/miniprogram/src/pages/works/index.scss`
- Create: `apps/miniprogram/src/features/generation/generation-state.ts`
- Create: `apps/miniprogram/src/features/generation/generation-state.test.ts`
- Create: `apps/miniprogram/src/platform/album.ts`
- Create: `apps/miniprogram/src/platform/share.ts`

**Interfaces:**
- Consumes: `workApi.createWork`, `getWork`, `listWorks`, and `deleteWork`.
- Produces: `GenerationState`, `saveWorkToAlbum(work)`, and share metadata that never contains the original file URL.

- [ ] **Step 1: Write failing generation state tests**

```ts
it('ignores a second submit while one request is running', () => {
  const running = transition(initialState, { type: 'submit', requestId: 'request-1' })
  expect(transition(running, { type: 'submit', requestId: 'request-2' })).toEqual(running)
})

it('keeps editor state after a retryable network failure', () => {
  const failed = transition(runningState, { type: 'failed', code: 'NETWORK_ERROR' })
  expect(failed.editorState).toEqual(runningState.editorState)
  expect(failed.canRetry).toBe(true)
})
```

- [ ] **Step 2: Implement the state machine and route registration**

Allowed transitions are `idle → uploading → processing → ready` and `uploading|processing → failed → uploading|processing`. Generate one UUID `requestId` on first submit and reuse it for retry until the user changes template or source image.

- [ ] **Step 3: Connect editor submission to CloudBase**

Upload the selected local file to private path `uploads/{openidOpaque}/{requestId}/source.<ext>`, call `createWork`, and navigate to processing. Do not derive or expose the real `openid` in the client path; use a random session-scoped opaque directory and let the cloud function enforce ownership.

- [ ] **Step 4: Implement result actions**

`saveWorkToAlbum` downloads a temporary result URL, calls `wx.saveImageToPhotosAlbum`, and maps denied permission to an explanation plus `wx.openSetting`. Share metadata contains template name, work ID, and cover URL only. “再做一个” preserves the reusable `subjectFileId` indirectly through the previous work ID; the server validates ownership before reuse.

- [ ] **Step 5: Implement work history and expiry**

List current-user works newest first. Ready items open result. Failed items offer retry. Expired items show a local expired state without requesting a URL. Delete calls `deleteWork`, asks for confirmation, removes the item from local state after success, and never bulk-deletes.

- [ ] **Step 6: Run tests, compile, and commit**

Run: `pnpm --dir apps/miniprogram test && pnpm --dir apps/miniprogram build:weapp`  
Expected: state, permission, share metadata, expiry, and delete tests PASS; production build succeeds.

```bash
git add apps/miniprogram/src
git commit -m "feat: complete generation result and history flow"
```

### Task 7: Add analytics, lifecycle cleanup, privacy copy, and release verification

**Files:**
- Create: `apps/miniprogram/src/services/analytics.ts`
- Create: `apps/miniprogram/src/services/analytics.test.ts`
- Create: `cloudfunctions/cleanup-expired/package.json`
- Create: `cloudfunctions/cleanup-expired/index.ts`
- Create: `cloudfunctions/cleanup-expired/index.test.ts`
- Create: `docs/release/privacy-data-map.md`
- Create: `docs/release/mvp-checklist.md`
- Create: `tests/e2e/mvp-flow.test.ts`
- Create: `tests/e2e/fixtures/safe-portrait.jpg`

**Interfaces:**
- Consumes: event names and retention periods from the spec.
- Produces: `track(eventName, properties)`, scheduled cleanup behavior, and one automated happy-path smoke test.

- [ ] **Step 1: Write failing analytics allowlist tests**

```ts
it('drops properties that are not declared for the event', async () => {
  await track('generation_success', {
    templateId: 'pat-head', durationMs: 4200, outputKb: 830,
    originalImageUrl: 'private-value',
  })
  expect(send).toHaveBeenCalledWith('generation_success', {
    templateId: 'pat-head', durationMs: 4200, outputKb: 830,
  })
})
```

- [ ] **Step 2: Implement the exact eleven-event allowlist**

Use the event names and properties from the spec. Hash or omit user identity before writing analytics. Batch at most 20 events and flush on app hide; failed batches may retry once and must not block generation UX.

- [ ] **Step 3: Write and implement lifecycle cleanup tests**

The cleanup function must:

1. delete original and subject files with expiry before the current time;
2. delete result and cover files after 30 days;
3. keep the work record and mark it `expired`;
4. tolerate a previously missing file;
5. process records in bounded pages of 100.

Run: `pnpm --dir cloudfunctions/cleanup-expired test`  
Expected: all five behaviors PASS.

- [ ] **Step 4: Write the privacy data map and release checklist**

`privacy-data-map.md` must enumerate selected photo, generated files, temporary subject cutout, CloudBase openid, product events, purpose, storage location, retention, deletion trigger, and whether data is shared externally. `mvp-checklist.md` must include备案、服务类目、用户隐私保护指引、内容安全权限、CloudBase environment association, storage rules, iOS test, Android test, six-template verification, and proof that no payment/member/ad copy exists.

- [ ] **Step 5: Add one automated end-to-end smoke test**

Using WeChat's Mini Program automation support, cover:

```text
launch → open 摸头 → inject safe fixture selection → editor → generate
→ result ready → save action called → open works → work visible
```

Stub only CloudBase and album system boundaries; do not stub editor state or page navigation.

- [ ] **Step 6: Run the complete verification set**

Run: `pnpm test`  
Expected: all TypeScript unit suites PASS.

Run: `cd services/generator && python3.11 -m pytest -q`  
Expected: all Python suites PASS.

Run: `pnpm --dir apps/miniprogram build:weapp`  
Expected: production WeChat build succeeds.

Run: `node scripts/validate-templates.mjs`  
Expected: `Validated 6 templates`.

Then perform one iOS and one Android real-device pass using `docs/release/mvp-checklist.md`; record only pass/fail and device/WeChat versions, never user photos.

- [ ] **Step 7: Commit release readiness**

```bash
git add apps/miniprogram/src/services cloudfunctions/cleanup-expired docs/release tests/e2e
git commit -m "test: verify free mvp release flow"
```

## Self-Review Results

- Spec coverage: v1.0's six templates, browse, upload, moderation, editor, generation, save/share, history, retention, analytics, and release checks each map to a task.
- Deliberate exclusion: v1.1's four GIF utilities are a separate subsystem and therefore require a separate implementation plan after the expression-generation loop passes acceptance.
- Placeholder scan: every implementation step names its concrete files, interfaces, behavior, and verification command; no unresolved placeholder remains.
- Type consistency: TypeScript and Python share `requestId`, `workId`, `templateId`, `sourceUrl/sourceFileId`, `editorState`, output IDs, and the same speed values.
- Review Focus: invalid input, interrupted upload, processing failures, duplicate submission, and expired output are each assigned to an owning task and test.
