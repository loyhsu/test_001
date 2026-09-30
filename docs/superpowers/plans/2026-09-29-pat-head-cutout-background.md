# 摸头模板抠图与换背景实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在摸头模板中先获得真实透明主体，拖动/缩放并切换背景，再以相同编辑状态生成 GIF。

**Architecture:** 复用现有 CloudBase 私有上传、内容安全和生成器。在编辑器前调用受所有者和上传凭证保护的抠图接口，将透明主体临时存入私有存储；生成时复用该主体。背景 ID 与纯色配置单一存放在 `templates/pat-head/background-presets.json`，客户端构建产物和 Python 生成器均由它读取。

**Tech Stack:** Taro/React/TypeScript、CloudBase 云函数、FastAPI/Pydantic、Pillow、Vitest、Node test、pytest。

**Spec:** `docs/product/cutout-background-pat-head-v1.md`

## Global Constraints

- 本轮只承诺摸头模板端到端可生成；其他模板不扩展。
- 背景 ID 为 `template`、`sky-blue`、`cream`、`lavender`；纯色依次为 `#DCEEFF`、`#FFF0DC`、`#EFEAFF`。
- 图片及透明主体保存在私有存储；预览只返回短期临时 URL。
- 抠图完成后，源图和透明图按成功时间起算 24 小时到期；现有清理按小时执行，不能承诺故障时的绝对物理删除时限。
- 主体画布坐标为 480×480；x/y 范围 0–480，scale 范围 0.65–1.6；速度为 `slow | standard | fast`。
- 生成 GIF 不超过 8 MiB；不增加付费服务、用户上传背景或手动修边。
- 保留当前工作树已有改动；本计划不包含提交、推送或部署。

## Review Focus

- 外人或其他请求的上传凭证、错路径、已消费凭证不得取得透明图；由 Task 3 的所有权和事务测试覆盖。
- 损坏、超限、内容安全拒绝或未识别主体的照片不得进入可生成编辑态；由 Task 2/3 测试覆盖。
- 重复准备、服务失败及上传成功但数据库更新失败不得留下可访问的孤儿透明图；由 Task 2/3/4 的幂等和清理测试覆盖。
- 已过期临时 URL 应能为同一所有者刷新，且不能泄露永久文件 ID；由 Task 3/5 测试覆盖。
- 四种背景映射、主体缩放和坐标不能在预览与 GIF 间漂移；由 Task 1/5 的颜色与坐标测试覆盖。

---

### Task 1: 单一背景配置与生成器合成

**Files:**
- Create: `templates/pat-head/background-presets.json`
- Modify: `scripts/validate-templates.mjs`
- Test: `scripts/validate-templates.test.mjs`
- Create/Regenerate: `apps/miniprogram/src/generated/background-presets.ts`
- Modify: `services/generator/app/template_catalog.py`
- Modify: `services/generator/app/models.py`
- Modify: `services/generator/app/compositor.py`
- Test: `services/generator/tests/test_models.py`
- Test: `services/generator/tests/test_compositor.py`

**Interfaces:**
- `templates/pat-head/background-presets.json` 是背景 ID、标签和色值的唯一来源；`scripts/validate-templates.mjs` 负责校验并生成客户端 TS 常量，生成器从同一 JSON 读取。
- `EditorState.backgroundId: str = "template"`；只接受配置中定义的四个 ID。缺省值保持旧作品兼容。
- `compose(..., editor_state=...)` 在 `template` 时读模板原背景，在其他 ID 时以对应纯色创建 480×480 背景。

- [x] **Step 1: 写失败测试** — 增加 `test_background_config_rejects_duplicate_or_invalid_presets`，断言重复 ID、非法色值失败且生成客户端配置含四个 ID/精确色值；增加 `test_editor_state_validates_background_id`，断言四个 ID 可用、未知 ID 被拒绝且缺省为 `template`；增加 `test_preset_background_replaces_manifest_background`，断言 `sky-blue` 输出像素为 `#DCEEFF` 且 `template` 仍使用模板背景。
- [x] **Step 2: 运行目标测试确认失败** — `node --test scripts/validate-templates.test.mjs`；`cd services/generator && uv run --python 3.11 pytest -q tests/test_models.py tests/test_compositor.py`。预期因配置/字段/合成逻辑缺失而失败。
- [x] **Step 3: 实现配置校验、客户端 TS 生成及生成器背景读取/校验** — 保持原模板图作为默认项，纯色由 Pillow `Image.new` 创建；不引入新依赖。
- [x] **Step 4: 运行目标测试确认通过** — 重跑 Step 2 命令，并运行 `node scripts/validate-templates.mjs` 更新生成文件。

### Task 2: 生成器抠图预处理接口

**Files:**
- Modify: `services/generator/app/models.py`
- Modify: `services/generator/app/main.py`
- Modify: `services/generator/app/storage.py`
- Test: `services/generator/tests/test_api.py`
- Test: `services/generator/tests/test_storage.py`

**Interfaces:**
- `PrepareSubjectRequest(sourceUrl: str, subjectObjectPath: str)`；仅接受 HTTPS 源 URL 和 `uploads/{ticketId}/{requestId}/subject.png` 形态的路径。
- `PrepareSubjectResponse(subjectFileId: str, width: int, height: int)`。
- `prepare_subject_and_store(request, *, workspace_root=None, source_fetcher=..., matting_provider=None, storage=None) -> PrepareSubjectResponse`：校验原图、执行现有 `RembgMattingProvider`、裁到透明 alpha bounds、上传私有 PNG 并返回文件 ID 与像素尺寸。
- `POST /v1/prepare-subject` 使用与 `/v1/generate` 相同的 Bearer 内部令牌和稳定错误码。
- `CloudBaseStorage.upload_subject(subject_path: Path, object_path: str) -> str` 上传到调用方指定的受限上传路径；失败时回滚本次已上传对象。

- [x] **Step 1: 写失败测试** — 增加 `test_prepare_subject_route_requires_bearer_token`、`test_prepare_subject_crops_alpha_bounds_and_returns_metadata`、`test_prepare_subject_rejects_missing_subject`；增加 `test_uploads_prepared_subject_as_private_png` 和 `test_rejects_subject_object_path_outside_upload_scope`，分别断言 PNG MIME/CloudBase ID 与路径拒绝。
- [x] **Step 2: 运行目标测试确认失败** — `cd services/generator && uv run --python 3.11 pytest -q tests/test_api.py tests/test_storage.py`。
- [x] **Step 3: 实现请求/响应模型、预处理函数、认证路由和私有 subject 上传** — 复用现有下载、图片验证、抠图和存储客户端。
- [x] **Step 4: 重跑目标测试确认通过** — 使用 Step 2 命令。

### Task 3: Cloud Function 所有权校验、预处理票据与生成复用

**Files:**
- Modify: `cloudfunctions/work-api/src/generator-client.js`
- Test: `cloudfunctions/work-api/src/generator-client.test.js`
- Modify: `cloudfunctions/work-api/src/repository.js`
- Test: `cloudfunctions/work-api/src/repository.test.js`
- Modify: `cloudfunctions/work-api/src/router.js`
- Test: `cloudfunctions/work-api/src/router.test.js`
- Modify: `cloudfunctions/work-api/index.js`

**Interfaces:**
- `createGeneratorClient({ endpoint, token, fetchImpl }) -> { generateWork(input), prepareSubject(input) }`；由现有 `/v1/generate` 地址推导同服务 `/v1/prepare-subject` 地址。
- 新 action `prepareSubject({ requestId, uploadTicketId, sourceFileId }) -> { subjectUrl, width, height, expiresAt }`；只返回短期 URL，不向客户端返回永久 subject FileID。
- 仓储新增 `updateUploadTicket(id, patch)`；`createProcessingWork(work, uploadTicketId, openid)` 的事务需验证票据属于用户、仍为 issued、未过期、源路径匹配且已包含未过期 subject，然后原子消费票据并创建 Work。Work 的 source/subject expiry 使用预处理完成时记录的 expiry。
- `createWork` 必须复用票据中已抠出的 subject，生成请求使用 `subjectUrl` 和 `reusedSubjectFileId`；不重复下载/审核/抠图。失败 Work 重试继续复用其 subject。

- [x] **Step 1: 写失败测试** — generator client 增加 `test_prepare_subject_uses_sibling_endpoint_and_validates_private_id`；repository 增加 `test_consumes_only_owned_unexpired_prepared_ticket`；router 增加 `test_prepare_subject_moderates_before_matting_and_returns_temporary_url`、`test_prepare_subject_rejects_foreign_or_expired_ticket`、`test_prepare_subject_retry_reuses_stored_cutout`、`test_create_work_reuses_prepared_subject_and_background`、`test_prepare_subject_removes_uploaded_file_if_ticket_update_fails`。断言永久 subject ID 不出现在客户端响应、createWork 不重复审核/抠图、Work expiry 等于票据 expiry。
- [x] **Step 2: 运行目标测试确认失败** — `node --test cloudfunctions/work-api/src/generator-client.test.js cloudfunctions/work-api/src/repository.test.js cloudfunctions/work-api/src/router.test.js`。
- [x] **Step 3: 实现 generator client 双方法、票据更新/消费及受保护的 prepareSubject/createWork 路由** — 成功抠图后将 source/subject 到期时间设为成功时刻起 24 小时；重复 prepare 返回刷新后的临时 URL。
- [x] **Step 4: 重跑目标测试确认通过** — 使用 Step 2 命令。

### Task 4: 清理未使用的过期上传和抠图文件

**Files:**
- Modify: `cloudfunctions/cleanup-expired/index.js`
- Test: `cloudfunctions/cleanup-expired/index.test.js`
- Modify: `docs/release/privacy-data-map.md`

**Interfaces:**
- `cleanupExpired` 增加 `listExpiredUploadTickets({ offset, limit, now })` 与 `deleteUploadTicket(id)` 依赖；只处理 `status === "issued"` 且已过期的票据。
- 清理已过期票据的 sourceFileId 与 subjectFileId；文件不存在按已清理处理。`consumed` 票据由 Work 生命周期负责，不得清掉仍被 Work 引用的 subject。

- [x] **Step 1: 写失败测试** — 增加 `test_cleans_expired_issued_ticket_source_and_subject`、`test_keeps_live_and_consumed_upload_tickets`、`test_keeps_ticket_when_file_deletion_fails_for_retry`；分别断言源图/透明图/票据删除、有效或已消费票据不动、失败记录保留供下次重试。
- [x] **Step 2: 运行目标测试确认失败** — `pnpm --dir cloudfunctions/cleanup-expired test`。
- [x] **Step 3: 实现分页查询、文件删除及票据记录清理** — 在清理完成后移除记录；删除失败时保留记录以便下轮重试。
- [x] **Step 4: 更新隐私数据流说明** — 记录预览前上传、临时透明图路径、24 小时到期与按小时清理的实际延迟。
- [x] **Step 5: 重跑目标测试确认通过** — 使用 Step 2 命令。

### Task 5: 编辑器抠图预览、背景选择与完整流程接线

**Files:**
- Modify: `apps/miniprogram/src/domain/contracts.ts`
- Modify: `apps/miniprogram/src/services/work-api.ts`
- Create: `apps/miniprogram/src/services/photo-preparation.ts`
- Test: `apps/miniprogram/src/services/photo-preparation.test.ts`
- Modify: `apps/miniprogram/src/features/editor/creation-store.ts`
- Test: `apps/miniprogram/src/features/editor/creation-store.test.ts`
- Modify: `apps/miniprogram/src/features/editor/editor-state.ts`
- Test: `apps/miniprogram/src/features/editor/editor-state.test.ts`
- Modify: `apps/miniprogram/src/features/editor/editor-coordinates.ts`
- Test: `apps/miniprogram/src/features/editor/editor-coordinates.test.ts`
- Modify: `apps/miniprogram/src/features/templates/template-data.ts`
- Modify: `apps/miniprogram/src/pages/editor/index.tsx`
- Modify: `apps/miniprogram/src/pages/editor/index.scss`
- Modify: `apps/miniprogram/src/pages/processing/index.tsx`
- Modify: `docs/product/expression-workshop-mvp-v1.md`

**Interfaces:**
- `PrepareSubjectInput = { requestId: string; uploadTicketId: string; sourceFileId: string }`；`workApi.prepareSubject(input)` 返回 `{ subjectUrl: string; width: number; height: number; expiresAt: string }`。
- `preparePhoto(image: SelectedImage, requestId: string, dependencies: PhotoPreparationDependencies) -> Promise<PreparedPhoto>`：依序创建票据、上传原图、调用 prepareSubject；依赖为 `createUploadTicket(input)`, `uploadFile(cloudPath, localPath) -> Promise<string>`, `prepareSubject(input)`；测试通过注入依赖，不触发真实网络。
- `PreparedPhoto` 在进程内保存原图、requestId、upload ticket、sourceFileId、短期 subjectUrl、subject 尺寸及过期时间；不写入永久本地存储。
- 编辑器生成请求沿用准备阶段的 requestId/ticket/sourceFileId；`ProcessingPage` 检测到已有准备数据时跳过重新上传，沿用 `createWork`。已有 `sourceWorkId` 的“再做一个”路径保持不变。
- 编辑画布以 264/480 作为抠图主体默认最大边（与生成器 55% 规则一致），使用 aspectFit 显示透明 PNG；坐标映射、slider scale 和动效速度传给现有生成请求。背景选项从生成的 `background-presets.ts` 读取。

- [x] **Step 1: 写失败测试** — 增加 `test_prepare_photo_uploads_before_requesting_cutout`、`test_prepare_photo_propagates_cutout_failure`；store/state 增加 `test_replacing_photo_clears_prepared_subject`、`test_background_selection_is_preserved_in_editor_state`；坐标增加 `test_drag_center_round_trips_for_generator_sized_subject`，断言 55% 显示主体的拖动中心映射往返一致。
- [x] **Step 2: 运行目标测试确认失败** — `pnpm --dir apps/miniprogram test -- src/services/photo-preparation.test.ts src/features/editor/creation-store.test.ts src/features/editor/editor-state.test.ts src/features/editor/editor-coordinates.test.ts`。
- [x] **Step 3: 实现上传预处理服务及编辑器交互** — 选图后显示抠图处理中/失败恢复态并保留原图；只接受当前选择照片对应的异步结果；成功后将透明 PNG 放入背景和动效层之间，主体以 `MovableArea` 实测边长的 55% 作为默认最大显示边、`aspectFit` 保持抠图比例；新增四种背景选择；重新显示页面时为仍有效的 ticket 换取新临时 URL；生成按钮仅在 subject 可用时启用。
- [x] **Step 4: 接通生成与失败恢复** — 将已准备的 ticket/FileID 和背景编辑状态送往 Processing；过期票据提示返回编辑器重新选图，不把未抠图原图送进生成器。
- [x] **Step 5: 更新主产品规格** — 编辑器说明加入背景选择；保留其他模板未打通的明确限制。
- [x] **Step 6: 运行目标测试和构建** — `pnpm --dir apps/miniprogram test`、`pnpm --dir apps/miniprogram exec tsc --noEmit`，并使用隔离输出目录执行 WeChat build，未覆盖已有 `dist`。

### 最终验收

- [x] `pnpm test`、`node --test cloudfunctions/work-api/src/*.test.js`、`pnpm --dir cloudfunctions/cleanup-expired test` 均通过。
- [ ] 微信开发者工具中用测试图片跑通：上传→抠图→拖动/缩放→切换四种背景→生成；对照编辑器预览和 GIF 检查主体位置、大小、背景色与动效速度一致。
- [ ] 不执行 CloudBase/生成器部署、提交或推送；如需这些外部操作，另行取得用户确认。
