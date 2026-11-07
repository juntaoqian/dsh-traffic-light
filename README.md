# 🚦 dsh-traffic-light

**DeepSeek Harness（DSH）Web UI 左下角的红绿灯状态控件。**
所有会话的运行 / 等待 / 空闲状态一眼可见，红灯与黄灯时响提示音；音效、音量、时长、判定规则都能在设置里改。

- 🟢 绿 = 有会话在运行
- 🔴 红 = 有会话在等你选择（审批 / 提问 / 计划确认）
- 🟡 黄 = 没有会话在运行

> 纯前端插件，无第三方 npm 依赖、无构建步骤、不需要文件/网络/工具权限；配色全部使用 DSH 主题 token，浅色/深色自动适配。
> 可选把同样的结论上报到一块公网红绿灯看板（见「上报到公网看板」）。
> 在 DSH `0.2.1-rc.5`（桌面版）上验证通过。

---

## ✨ 功能

- **左下角三灯控件**：位于侧边栏底部、Settings 按钮上方，三颗灯横向排列，当前状态那颗点亮（红灯带呼吸闪烁）。
- **汇总全部会话**：任一存在会话等待即红灯；任一运行即绿灯（可改为"全部会话都运行才绿灯"）。
- **等待数量角标**：红灯时在灯珠旁显示正在等待的会话数；悬停可看「运行中 / 等待选择 / 会话总数」。
- **状态切换蜂鸣**：进入红灯必响，红灯期间又多一个会话开始等待也响；进入黄灯（全部停下）可开关。
- **6 种音效**：经典蜂鸣 / 清脆铃音 / 短促提示 / 警报双响 / 低沉提示 / 上升三连音，切换即试听；音量、时长、重复次数共用。
- **设置页**：Settings →「红绿灯」，改动立即生效，重启后保留。
- **中英双语**：界面文字跟随 DSH 语言。

## 📍 位置

```
┌─────────────────────────────┐
│  侧边栏                      │
│   …会话列表…                 │
│                             │
│  [● ● ●]  运行中   ← 这里     │  ← 红绿灯（Settings 上方）
│  ⚙ 设置                       │
└─────────────────────────────┘
```

侧边栏展开时灯珠旁可显示状态文字；折叠成窄栏时只留三颗灯。Windows 标题栏模式下折叠侧边栏时 DSH 自身会隐藏整个侧栏脚部（Settings 一起隐藏），此时灯不可见，但蜂鸣仍工作。

## 🚦 状态与蜂鸣规则

| 灯 | 何时亮 | 蜂鸣 |
| --- | --- | --- |
| 🔴 红 | 任一存在会话的 `pendingInteraction` 非空（审批请求 / `ask_user_question` 提问 / 计划确认） | 进入红灯响；红灯期间等待数增加也响（总开关控制） |
| 🟡 黄 | 没有会话在运行，也没有会话在等待 | 进入黄灯时响（「回到空闲时也蜂鸣」控制，默认开） |
| 🟢 绿 | 有会话在运行（或"全部会话运行"，取决于设置） | — |

细节：

- 只在**状态切换**时响，不会因为重渲染、改设置、拖音量条而重复响。
- 页面刚打开时如果已经是红/黄，不会补响（只对变化响应）。
- 浏览器要求一次用户手势才能播放声音：点一下页面任意位置/按键之后即解锁，之后后台切换也会响。

### 灯旁边和提示语里显示什么

鼠标悬停（`title`）与设置页预览会拼出一行：

```
运行中 1 · 等待选择 1 · 会话共 3 · 等待：修复登录超时 · 等待审批 · 刚完成 1 个
```

| 片段 | 来源 | 说明 |
| --- | --- | --- |
| `等待：<会话标题>` | `useSessions` 的 `displayTitle` | 说清是哪一摊活在等你；最多列 2 条、每条截断到 18 字，更多时显示「等 N 个」 |
| `等待{审批/提问/计划确认/操作}` | `pendingInteraction.kind` | 只知道"在等"不够，这里说清在等哪一种选择；无法识别的类型归为「操作」 |
| `已等 N 分钟` | 插件自己打点 | 进入红灯起计时，超 1 分钟才显示；红灯期间每 15 秒刷新一次 |
| `刚完成 N 个` | `completionUnread` | 跑完但还没看的会话数，绿灯/黄灯时也有意义 |

会话标题**只出现在本机可见的地方**（悬停提示、设置页预览），不会进公网看板——看板文案只有灯色、计数、等待原因与时长。工作目录同理，目前没有显示。

## 📦 安装

前置：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（桌面版或 `dsh web`）。本插件依赖 DSH 的 Client slot 机制，没有其他 npm 依赖。

### 方式 A：图形界面（推荐）

1. 侧边栏打开 **Plugins**。
2. 点 **Add plugin** → **Install a third-party plugin**。
3. 包名处填：

   ```
   git+https://github.com/juntaoqian/dsh-traffic-light.git
   ```

4. **Install**，完成后确认该 bundle 已启用（enabled）。
5. 看侧边栏左下角；打开 Settings 会多出「红绿灯」一页。

### 方式 B：让 Agent 安装

在 DSH 会话里说：

> 安装插件：`plugin_manager` 的 `install_bundle`，target 用 `git+https://github.com/juntaoqian/dsh-traffic-light.git`

### 方式 C：本地开发安装（可热更新）

```powershell
git clone https://github.com/juntaoqian/dsh-traffic-light.git
```

再让 DSH 以**该目录的绝对路径**执行 `install_bundle`（会以 `link:` 方式安装）。之后改 `client.js` 由 DSH 热更新，页面不刷新即可看到效果。

### 卸载

Plugins → 找到 `dsh-traffic-light` → **Remove**（或 `plugin_manager` 的 `remove_bundle`）。

### 如果 GitHub 连不上（`connection to github.com timed out` / `Connection was reset`）

DSH 在安装 Git 仓库前会先用 `git ls-remote` 做一次连通性检查（默认 5 秒超时）。国内网络下这一步容易超时，依次尝试：

1. 点重试（通常是偶发）。
2. 在 profile 的 `cordis.patch.yml` 里给 `pluginManager` 行调大 `githubConnectionTimeoutMs`（例如 `20000`），重启 DSH 后再装。
3. 先 `git clone`（走代理/镜像）到本地，再用上面的**方式 C（本地目录）**安装。
4. 在能访问 GitHub 的机器上把仓库打包拷过来，本地安装。

> 作者环境到 GitHub 的连接不稳定，Git 方式安装未能在本机全程实测；**本地目录安装**与插件功能已在 DSH `0.2.1-rc.5` 上验证。仓库本身已设为公开，`api.github.com` 匿名可读。

## ⚙️ 设置

**Settings → 红绿灯**

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| 显示红绿灯控件 | 开 | 关掉只隐藏灯，其余设置与蜂鸣保留 |
| 蜂鸣提醒 | 开 | 蜂鸣总开关（对应红灯切换） |
| 回到空闲时也蜂鸣 | 开 | 黄灯切换时也响 |
| 音效 | 经典蜂鸣 | 6 种音色，切换即试听 |
| 蜂鸣音量 | 60% | 0 = 静音 |
| 蜂鸣时长 | 160 ms | 40–1200 ms，整套音效按比例缩放 |
| 蜂鸣次数 | 1 | 1–5，整套音型重复 |
| 绿灯判定 | 任一会话运行 | 或「全部会话运行」 |
| 显示状态文字 | 开 | 侧边栏展开时在灯珠旁显示状态 |
| 显示等待数量 | 开 | 红灯时显示数字角标 |

另有「试听音效」「恢复默认」两个按钮。

### 6 种音效

| 音效 | 听感 |
| --- | --- |
| 经典蜂鸣 | 单声 880 Hz 正弦 |
| 清脆铃音 | 1318 Hz + 1760 Hz 双泛音，门铃感 |
| 短促提示 | 1046 Hz 三角波 + 2093 Hz 高泛音，极短 |
| 警报双响 | 980 Hz → 735 Hz 两下沉音 |
| 低沉提示 | 440 Hz + 220 Hz 低音叠加 |
| 上升三连音 | C-E-G（523 / 659 / 784 Hz）上行琶音 |

设置保存在浏览器 `localStorage` 的 `dsh.traffic-light.options.v1`；同一页面的两个座位共享同一个 store，改动实时同步；多窗口之间通过 `storage` 事件同步。

## 🌐 公网看板：怎么用

一句话：让一块公网可见的看板显示这台机器**在跑、空闲，还是在等你操作**。

### 扫码配对（推荐）

Settings → 红绿灯 → 公网看板 → 点 **生成二维码**，手机扫一下即可：

```
电脑：生成配对二维码  →  手机扫码  →  看板页面确认  →  插件自动拿到 code / channel
```

成功后设置页显示 **已连接设备：`iPhone-15`（通道 `ch-pair-1`）**，二维码自动切换成「这条通道」的链接，可复制发给别人。

配对期间插件每 2 秒问一次结果，`token` 过期就提示重新生成；看板没有这些路由时直接降级成「接入码」方式，不会卡住。

#### 服务端要实现的三个接口（契约 v1）

```http
POST {BASE}/api/pair/create?sharecode=SC
     X-Control-Key: <部署 key，可选>
→ 200 { "ok": true, "token": "PT-3f9a", "expiresIn": 300,
        "qr": "https://<base>/pair?t=PT-3f9a" }      # qr 省略时插件按 /pair?t=&s= 自行拼

GET  {BASE}/api/pair/status?sharecode=SC&token=PT-3f9a
→ 200 { "ok": true, "status": "pending" }
→ 200 { "ok": true, "status": "paired",
        "device": { "id": "dev-1", "name": "iPhone-15" },
        "channel": "ch-pair-1", "code": "TL-PAIR-0001" }    # 也可回 secret
→ 200 { "ok": true, "status": "expired" }                     # 或 "denied"

POST {BASE}/api/device/ping?sharecode=SC&channel=ch-pair-1
     X-Control-Key: <部署 key>    X-Control-Code: TL-PAIR-0001
→ 200 { "ok": true }
```

约定：

- `token` 一次性，建议 5 分钟过期。手机扫码后由**看板页面**调 `POST /api/pair/confirm`（body 带 `token`）把它标记为 paired，并在这一步分配 `device` / `channel` / `code`——分配逻辑复用现有 `/api/device/register` + `/api/claim` 即可。
- 插件拿到 `code` 后**立刻**用原有的 `POST /api/set` 上报，不需要再注册一次设备。
- `ping` 每 20 秒一次；建议服务端 **30–60 秒收不到就显示离线**，这样关掉页面不会一直挂着最后一盏灯。
- 三条路由任一返回 404，插件判定「看板不支持配对」，回退到接入码，并在设置页写明原因。

### 接入码（备用，不需要改服务端）

Settings → 红绿灯 → 公网看板 → 高级设置 → **接入码**，把下面任意一种粘进去，回车即可：

```
https://traffic-light-control-97708.app.workbuddy.host/?sharecode=3R6XRRCJN6      看板链接
https://traffic-light-control-97708.app.workbuddy.host|3R6XRRCJN6|TL-Ctl-xxxxxx   base|sharecode|key，一行搞定
3R6XRRCJN6                                                                       只换 sharecode，地址/key 沿用当前值
```

粘贴后插件会解析出地址 / sharecode / 写权限 key，**自动注册设备、认领通道并立即上报一次**。状态行随后显示「已连接，通道 `ch-xxxxxx`」。

> **写权限 key 仍然要单独给**：它是全局写权限密码，不在链接里也不在仓库里。链接里带 `&key=...` 或第三段就一次到位；不带的话，在「高级设置」里补一次即可。

### 手机扫码看这台机器

连接成功后，同一页会出现一个**二维码**（＋这条通道的链接）：

- 手机扫一下 → 直接打开你的通道，灯色和文案跟着本地灯变化，不用在手机上再输 sharecode。
- 「复制链接」把这条带 `channel=` 的链接发给别人；「打开看板」在电脑上打开同一页。

二维码由 Host 半边用 vendored `qrcode-generator`（MIT）渲染成 SVG，客户端不引入任何依赖，也不联网取码。

### 看板上会显示什么

| 本地灯 | 上报 `status` | 看板表现 | 文案示例 |
| --- | --- | --- | --- |
| 🟢 运行中 | `ok` | 绿灯常亮 | `CXQJT：会话正在运行` / `CXQJT：3 个会话运行中` |
| 🟡 空闲 | `idle` | 黄灯常亮 | `CXQJT：没有会话在运行` |
| 🔴 等待选择 | `action` | 红灯 + 闪烁 + 蜂鸣 | `CXQJT：等你审批（已等 3 分钟）` / `CXQJT：2 个会话等你处理（审批 / 提问）（刚刚）` |

开头的 `CXQJT` 是本机名（「看板设备名」留空时自动取 `os.hostname()`），多台机器不用手填也能区分；填了就用你填的。

红色那行会带上**在等哪一种选择**和**已经等了多久**——远端看板的人最想知道这两件事。文案里不含会话标题、工作目录、prompt 摘要：看板是公开可读的。

### 设置项

**Settings → 红绿灯 → 公网看板**：

| 设置项 | 默认 | 说明 |
| --- | --- | --- |
| 接入码 | — | 粘看板链接 / `base\|sharecode\|key` / 纯 sharecode，回车即配置并连接 |
| 上报状态到看板 | 关 | 打开后同步灯色；第一次开启自动注册设备并认领通道 |
| 二维码 | 连接后出现 | 手机扫码直接打开这条通道；可复制链接 |
| 高级设置（折叠） | — | 看板设备名、看板地址、sharecode、写权限 key、文案开关 |
| 看板设备名 | 留空 = 本机名 | 看板上显示的名字，也是注册 / 认领用的名字，≤24 字 |
| 看板地址 | 部署默认值 | 接口根地址，一般不用改 |
| sharecode | 部署默认值 | 平台链接校验，漏了所有请求 403 |
| 写权限 key | **空（必填）** | 全局写权限密码，向部署方索取；只存本机 `localStorage`，插件不内置默认值 |
| 同步提示词文本 | 开 | 是否连「几个会话在跑 / 等你审批」的文案一起上报 |

### 行为细节

- 只在状态**真的变化**时上报：重复渲染、改设置都不会重复发请求（服务端也会合并同状态日志）。
- 首次开启依次调用 `POST /api/device/register` → 用返回的 `secret` 换 `code` → `POST /api/claim` 认领通道；`deviceId / secret / code / channel` 存进 `localStorage` 的 `dsh.traffic-light.board.v1`。
- 写状态时 `sharecode / channel / status / label / text / duration` 全部放 **URL 查询串**，`X-Control-Key` / `X-Control-Code` 放请求头（不进访问日志）。
- 通道在服务端消失（404）时会用 `deviceId + secret` 取回控制码、重新认领一次再重试。
- 改「看板设备名」（或同名留空、由本机名接手）后，下一次上报会调 `POST /api/alias` 把通道别名同步过去；只有名字真的变了才调，失败也不影响灯色上报。
- 请求由 **Host 半边**（Node）经同源代理 `/dsh-traffic-light/api/board/report` 发出，渲染进程的 CSP / 跨域都挡不住；代理不可用时自动回退浏览器直连。本机名走同一侧的同源路由 `/dsh-traffic-light/api/board/info`（只允许本机访问）。
- 没有心跳：关掉页面后看板停在最后一次状态（避免多余请求与限流）。

> ⚠️ **实测部署实例只认查询串**：`/api/set` 的 JSON body 与表单 body 会被静默忽略（返回 `applied: []` 且写入落到 `default` 通道），与接入文档「三种传参方式」的说法不一致。插件因此只用查询串，body 保持为空。

## 🧰 排查常见现象

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 插件整个消失（灯、设置页、Plugins 里都没有），且没有任何报错 | 安装副本的 `package.json` 与 Loader 行名不一致，DSH 静默跳过客户端条目 | 见「开发」最后一条：别用源码 `package.json` 覆盖安装副本 |
| 状态行「网络不可达，或被浏览器跨域策略拦截」 | 渲染进程跑在 `dsh-app://`，直连 https 被 CORS 拦，而代理路由还没挂上 | 重启 DSH 让 Host 半边加载；错误行会附带「代理失败：…」的具体原因 |
| 状态行「请先填写写权限 key（向看板部署方索取）」 | 插件不自带 key，本机还没填 | 在「写权限 key」里填入部署方给的值，回车保存 |
| 状态行「上报失败：HTTP 401」 | key 不对，或没带控制码 | 核对「写权限 key」；「清除凭据」后重连 |
| 状态行「上报失败：HTTP 403」 | 少了 sharecode / 控制码无效 | 核对 sharecode，或用「清除凭据」重新注册 |
| 状态行「上报失败：HTTP 429」 | 配额用尽，或失败过多被锁 10 分钟 | 别连续点「连接看板」，等 10 分钟 |
| 看板永远是最后一次状态 | 没有心跳，页面关了没人再写 | 正常行为；要「关机即变黄」可自行加 keepalive 上报 |
| 改了 `client.js` 没生效 | 防重入保护会忽略热更新 | 刷新页面；改了 Host 半边（`index.js` / `proxy.js`）则要重启 DSH |

## 🧩 工作原理（想改它的人看这里）

三个座位（slots），四个组件：

| 座位 | 组件 | 作用 |
| --- | --- | --- |
| `sidebar.footer.action` | `FooterControl` | 左下角红绿灯本体 |
| `settings.section` | `SettingsPage` | Settings 里的配置页（含看板设置） |
| `shell.overlay` | `StatusWatcher` | 无渲染的蜂鸣监听器（侧栏折叠/脚部被隐藏时仍然工作） |
| `shell.overlay` | `BoardReporter` | 无渲染的上报器：状态变化后 400 ms 去抖写一次看板 |

- **状态来源**：只用宿主通过 slot 传入的标准 hook `useSessionStatus(selector)`，返回值是 `Map<sessionId, { running, pendingInteraction, completionUnread }>`；`pendingInteraction` 非空就是"等待选择"。插件不订阅会话事件、不读 DOM、不扫描其他插件。
- **样式**：只用 `--dsw-alias-*` 主题 token（`state-error-primary` / `state-warn-primary` / `state-success-primary` 等），`prefers-reduced-motion` 下关闭呼吸动画。
- **蜂鸣**：Web Audio 合成（每个音符一条 `OscillatorNode` + `GainNode` 指数衰减包络），6 种音色在 `SOUND_PRESETS` 里各写几行音符即可新增。
- **上报**：`boardUrl()` 统一拼 `sharecode` 与参数，`boardRequest()` 先 POST 给 Host 半边的同源代理、失败再回退浏览器直连；代理侧 `createBoardProxy()` 只放行本机调用与 `*.app.workbuddy.host`，并把看板的 4xx 原样回传，客户端据此映射 401/403/404/429。`claimBoard()` 负责注册+取回+认领（并发用 `claimPromise` 合流），`drainBoardReports()` 串行发送并在失败时把状态改成 error 显示在设置页。
- **Host 半边**：`index.js` 在 `ctx.webServer` 上挂一个 `prefix` 路由（与 `dsh-vars` 同样的做法），`proxy.js` 里是真正发请求的处理器；不写文件、不注册其他服务。

## 📁 文件结构

```
package.json         # dsh.bundle + dsh.client 声明（名字、入口、加载顺序）
cordis.patch.yml     # 插入名为 traffic-light 的 Loader 行
index.js             # Host 半边：把看板代理挂到 webServer
proxy.js             # 代理处理器（本机限定 + 域名白名单 + 原样回传状态码）
client.js            # 全部 UI / 状态 / 音效 / 设置 / 上报（纯 JS，无构建产物）
locale/en.json       # Plugins 页面显示名（英文）
locale/zh.json       # Plugins 页面显示名（中文）
icon.svg             # 插件图标
LICENSE              # MIT
```

## 🛠 开发

- `client.js` 是 `window.__ModuleLoader__.load({ id, factory })` 形式的纯 JS，没有 JSX、没有构建步骤。改完保存即由 DSH 热更新（本地 link 安装时）。
- 语法自检：`node --check client.js`。
- 改 `package.json` 的 `name` / `version` 属于"换包"，需要卸载重装。
- 新增音效：在 `SOUND_PRESETS` 加一条 `名字(start, length, play)`，并在 `SOUND_KEYS`、两套语言字典里各加一项。
- **不要提交写权限 key。** `client.js` 里 `BOARD_KEY` 的默认值是空字符串，key 只从本机 `localStorage` 读取；调试时也不要把真实 key 写进代码或用 `-c` 传给 git。这个仓库是公开的，key 一旦进历史就很难真正清除。
- **不要用源码的 `package.json` 覆盖安装副本里的那份。** 安装副本（`profiles/<profile>/node_modules/@local/dsh-traffic-light`）的 `name` 会被安装器改写成安装别名 `@local/dsh-traffic-light`；DSH 用「Loader 行名 === package.json 的 name」定位客户端 bundle（`client-modules` 的 `nearestPackage`）。名字对不上时它**静默**跳过客户端条目：灯、设置页、插件图标一起消失，且不写任何错误日志。源码保留上游包名 `dsh-traffic-light` 即可，重装会重新改写。

## ⚠️ 已知限制

- 红绿灯展示的是当前页面能看到的会话集合（与侧边栏会话列表一致，含子会话）。
- Windows 标题栏模式下折叠侧边栏时，DSH 自身会隐藏侧栏脚部（Settings 同理），此时灯不可见；蜂鸣与上报仍生效。
- 浏览器自动播放策略：首次提示音需要页面先有一次点击/按键。
- 依赖 DSH 的 slot / hook 名称（`sidebar.footer.action`、`settings.section`、`shell.overlay`、`useSessionStatus`）；DSH 大版本若调整这些接口，插件可能需要适配。
- 看板没有心跳：关掉页面/退出 DSH 后，看板会停在最后一次状态（这样不会为"还活着吗"反复请求、也不会触发限流）。要看状态是否新鲜，看板上的「多久之前更新」即可。
- `X-Control-Key` 与设备 `secret` 都存在浏览器 `localStorage`（`dsh.traffic-light.options.v1` / `dsh.traffic-light.board.v1`），共用电脑时注意。key 不在代码里，换机器要重新填一次。
- 一台机器一个通道：同一浏览器多开窗口会共享同一台设备；多台机器请用不同的「看板设备名」。
- 看板文案（`text` / `label`）公开可读，插件只写灯色与会话数量，不含会话标题等敏感内容。
- **请求经由 Host 半边发出**：浏览器端只 POST 到同源路由 `/dsh-traffic-light/api/board/report`，由 DSH 的 Host 进程（Node）真正访问看板并原样回传状态码。这样 `connect-src` CSP、非 `http(s)` 页面来源、CORS 都不会再挡住上报；代理只允许本机调用、只允许 `https://*.app.workbuddy.host`、只转发两个控制头。若该路由不可用（旧版 DSH 或从局域网地址打开），客户端会自动回退成浏览器直连。
- 改了 `index.js` / `proxy.js` 需要**重启 DSH** 才生效（Host 半边不热更新）；只改 `client.js` 刷新页面即可。
- 公网看板有配额：注册设备 20 台/IP/小时、全局 300 台；新建通道 5 个/IP/小时。反复点「清除凭据」会不断注册新设备。

## 📄 License

[MIT](LICENSE) © 2026 juntaoqian

---

## English quick start

A traffic-light status control at the DeepSeek Harness Web UI sidebar foot.

- 🟢 Green: sessions are running
- 🔴 Red: a session is waiting for your choice (approval / question / plan review) — beeps
- 🟡 Yellow: nothing is running — beeps when it switches to idle (optional)

**Install:** open **Plugins → Add plugin → Install a third-party plugin** and enter
`git+https://github.com/juntaoqian/dsh-traffic-light.git`, then enable the bundle.

**Configure:** **Settings → Traffic light** (show/hide, beep on/off, idle beep, 6 tones, volume, length, repeat count, green rule, label, waiting badge).

**Caption:** the hover text names what is blocking you (approval / question / plan review), how long it has waited and how many sessions finished unread.

**Public board (optional):** the same verdict can be pushed to a public AI status board. Turn on **Report status to the board** and it registers this machine, claims a channel, then mirrors the lamps: green → `ok`, amber → `idle`, red → `action` (red + blink + beep). The device label defaults to this machine's hostname; the caption says what it is waiting for and for how long. Credentials live in `localStorage`; writes go through the query string because the deployed service ignores request bodies.

**Public board (optional):** the same verdict can be pushed to a public AI status board. Turn on **Report status to the board**, set a **device name**, and the plugin registers this machine, claims a channel, then mirrors the lamps: green → `ok`, amber → `idle`, red → `action` (red + blink + beep). Credentials live in `localStorage`; writes go through the query string because the deployed service ignores request bodies.

No third-party dependencies, no build step, no Host permissions. UI copy is Chinese + English and follows the DSH locale. Tested on DSH `0.2.1-rc.5`.

MIT licensed. Screenshots welcome via PR.

## 维护信息

| 项 | 值 |
| --- | --- |
| 版本 | 1.4.0 |
| 测试 | .github/workflows/ci.yml（push / PR） |
| CI | 无单测（CI 做语法 / 清单 / locale 校验） |
| 问题反馈 | https://github.com/juntaoqian/dsh-traffic-light/issues |
| 源码 | https://github.com/juntaoqian/dsh-traffic-light |
| 许可证 | MIT |
