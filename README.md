# 🚦 dsh-traffic-light

**DeepSeek Harness（DSH）Web UI 左下角的红绿灯状态控件。**
所有会话的运行 / 等待 / 空闲状态一眼可见，红灯与黄灯时响提示音；音效、音量、时长、判定规则都能在设置里改。

- 🟢 绿 = 有会话在运行
- 🔴 红 = 有会话在等你选择（审批 / 提问 / 计划确认）
- 🟡 黄 = 没有会话在运行

> 纯前端插件，无第三方 npm 依赖、无构建步骤、不需要文件/网络/工具权限；配色全部使用 DSH 主题 token，浅色/深色自动适配。
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

## 🧩 工作原理（想改它的人看这里）

三个座位（slots）：

| 座位 | 作用 |
| --- | --- |
| `sidebar.footer.action` | 左下角红绿灯本体 |
| `settings.section` | Settings 里的配置页 |
| `shell.overlay` | 无渲染的蜂鸣监听器（侧栏折叠/脚部被隐藏时仍然工作） |

- **状态来源**：只用宿主通过 slot 传入的标准 hook `useSessionStatus(selector)`，返回值是 `Map<sessionId, { running, pendingInteraction, completionUnread }>`；`pendingInteraction` 非空就是"等待选择"。插件不订阅会话事件、不读 DOM、不扫描其他插件。
- **样式**：只用 `--dsw-alias-*` 主题 token（`state-error-primary` / `state-warn-primary` / `state-success-primary` 等），`prefers-reduced-motion` 下关闭呼吸动画。
- **蜂鸣**：Web Audio 合成（每个音符一条 `OscillatorNode` + `GainNode` 指数衰减包络），6 种音色在 `SOUND_PRESETS` 里各写几行音符即可新增。
- **Host 半边为空**：`index.js` 只有 `export function apply() {}`，用于让 `dsh.client` 进入启动图；不注册任何 Host 服务、不写文件。

## 📁 文件结构

```
package.json         # dsh.bundle + dsh.client 声明（名字、入口、加载顺序）
cordis.patch.yml     # 插入名为 traffic-light 的 Loader 行
index.js             # Host 半边（空）
client.js            # 全部 UI / 状态 / 音效 / 设置（纯 JS，无构建产物）
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

## ⚠️ 已知限制

- 红绿灯展示的是当前页面能看到的会话集合（与侧边栏会话列表一致，含子会话）。
- Windows 标题栏模式下折叠侧边栏时，DSH 自身会隐藏侧栏脚部（Settings 同理），此时灯不可见；蜂鸣仍生效。
- 浏览器自动播放策略：首次提示音需要页面先有一次点击/按键。
- 依赖 DSH 的 slot / hook 名称（`sidebar.footer.action`、`settings.section`、`shell.overlay`、`useSessionStatus`）；DSH 大版本若调整这些接口，插件可能需要适配。

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

No third-party dependencies, no build step, no Host permissions. UI copy is Chinese + English and follows the DSH locale. Tested on DSH `0.2.1-rc.5`.

MIT licensed. Screenshots welcome via PR.
