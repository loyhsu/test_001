# 表情工坊

微信小程序：上传照片、提取透明主体、调整位置和大小、换背景、生成 GIF，并管理自己的作品。

## 环境与依赖

使用 Node.js 22（见 `.nvmrc`）、pnpm 11.19.0、uv 和 Python 3.11。Python 依赖由 uv 按锁文件安装。

```sh
pnpm install --frozen-lockfile
cd services/generator
uv sync --locked --python 3.11
cd ../..
```

## 检查与构建

```sh
pnpm test
pnpm --dir apps/miniprogram exec tsc --noEmit
pnpm build:weapp
pnpm --dir apps/miniprogram build:h5
```

`pnpm test` 包含前端、模板清单、两个云函数和 Python 生成服务的测试。单元测试通过不代表已完成云端联调或真机验收。

## 微信小程序运行

在 `apps/miniprogram/.env.development.local` 配置以下环境变量，此文件已忽略，不要提交凭证：

```dotenv
TARO_APP_CLOUDBASE_ENV_ID=你的测试环境ID
```

项目 AppID 在 `apps/miniprogram/project.config.json`。执行 `pnpm dev:weapp` 后，用微信开发者工具导入 `apps/miniprogram/dist`。发布构建时，在构建环境设置同名变量，避免生成没有云环境配置的小程序包。

完整流程依赖已部署的 `work-api` 云函数、数据库、存储、内容安全权限及内部调用的 `generator` 服务。`cloudbaserc.json` 指向现有测试环境；操作前核对环境，不要直接用于生产环境。

## H5 预览的边界

```sh
pnpm --dir apps/miniprogram dev:h5
```

打开命令输出的地址。远程执行器需转发其监听端口。H5 可检查页面布局，但当前业务接口使用 `Taro.cloud.callFunction`，尚未接入浏览器认证和云开发 Web SDK；不要把 H5 当作可完整上传、抠图、生成的 Web 产品，也不要为预览开放云服务公网权限。

## 生成服务启动

```sh
cd services/generator
uv run --python 3.11 uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`GET /health` 可检查进程存活，不能证明模型、存储及生成链路可用。真实处理需要在服务端配置：

- `GENERATOR_INTERNAL_TOKEN`：内部调用密钥；`work-api` 的 `GENERATOR_TOKEN` 必须与其一致。
- `TCB_ENV_ID`：目标 CloudBase 环境。
- `TCB_API_KEY`：服务端凭证；也支持云托管注入的 `CLOUDBASE_APIKEY`。

生成接口使用 `X-Generator-Token` 请求头。凭证不能放进前端、仓库或日志；不要直接把本地生成服务暴露到公网。容器构建使用 `services/generator/Dockerfile`，服务监听端口为 8000。

## 验收重点

在微信开发者工具及 iOS/Android 真机验证：选模板 → 上传 → 抠图 → 拖动/缩放 → 换背景/预览 → 生成 → 保存 → 我的作品。

结果页已接入“发送表情到聊天”：下载 GIF 后，通过微信原生 `enterChatToolMode`（基础库 3.12.0 起）选择一个聊天，再调用 `shareEmojiToGroup`；若已处于聊天工具模式，则使用当前聊天。不支持时保留保存与使用指引，用户取消不自动发送或保存。发送时不附带私人作品页面入口。

这条路径仍须在有接口权限的微信真机验收；H5 和开发者工具不能替代真实发送验证。参考[微信官方接口定义](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)。目前不能宣称已支持“一键加入微信表情”：相册保存、发送表情、分享小程序卡片与加入表情收藏是不同能力。跨账号作品分享、非摸头模板的真实素材及授权也需补齐。发布前按 `docs/release/mvp-checklist.md` 逐项取得证据。
