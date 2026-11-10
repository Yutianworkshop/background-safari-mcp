# background-safari-mcp

[English](README.md) | **简体中文**

一个 MCP 服务器，让 AI 智能体在**你真实的 Safari 浏览器**里干活，沿用你已有的登录状态，同时**不接管你的电脑**。它在一个独立的后台窗口里工作，不移动你的鼠标，也不把 Safari 拉到前台。

不需要安装 Safari 扩展。仅支持 macOS。

关键词：Safari 自动化、浏览器自动化、MCP 服务器、Model Context Protocol、Claude Code、AI 智能体、后台操作、可信点击、跨域 iframe、macOS 辅助功能。

> **状态：实验性。** 几天内写成，代码主要由 AI 编程助手（Claude）在作者指导下完成，目前只在一台机器上跑过（macOS 27.2、Safari 27.2、英文界面、Apple 芯片）。会有粗糙之处。使用前请先读[安全须知](#安全须知)。

## 为什么做这个

Chrome 可以通过调试协议被程序控制，Safari 没有对应的东西。现有的 Safari 自动化工具，要么需要装扩展，要么干活时会占用你的鼠标和键盘。这个服务器把三条通道组合起来，让大部分工作在不打扰你的情况下完成：

| 通道 | 做法 | 事件是否可信 | 你的鼠标和焦点 |
|---|---|---|---|
| 脚本（默认） | 通过 Apple Events 注入 JavaScript | 点击和按键不可信；`fill` 产生的输入事件可信 | 不受影响 |
| 后台可信点击 | 用 macOS 辅助功能接口（`AXPress`）按下网页元素 | 可信 | 不受影响 |
| 系统输入（最后手段） | 真实的系统鼠标键盘事件（`CGEvent`） | 可信 | 占用 1 到 2 秒，Safari 会到前台（`native_hover` 会让 Safari 留在前台、指针停在元素上） |

有两件事在 Safari 自动化里不常见：

- **在被遮住的窗口里做可信点击。** `trusted_click` 通过辅助功能接口按下元素：页面收到的是可信点击，窗口可以被完全遮住，鼠标指针不会动。
- **不装扩展也能操作跨域 iframe。** 页面脚本进不去跨域框，但辅助功能接口可以。`snapshot` 会列出这类框里的内容，并给出以 `x` 开头的引用，`click`、`fill`、`get_page_text` 都认这些引用。

## 环境要求

- 装有 Safari 的 macOS。只在 macOS 27.2 / Safari 27.2 上测过。
- `PATH` 里有 [uv](https://docs.astral.sh/uv/)（依赖写在脚本头部，首次运行时自动下载）。
- 一个 MCP 客户端，例如 Claude Code 或 Claude Desktop。

## 安装

```bash
git clone https://github.com/Yutianworkshop/background-safari-mcp.git
cd background-safari-mcp
uv run --script safari_mcp.py   # 可选：先把依赖下载好；按 Ctrl-C 停止
```

在客户端里注册。Claude Code：

```bash
claude mcp add safari -s user -- uv run --script "$(pwd)/safari_mcp.py"
```

用 JSON 配置的客户端：

```json
{ "mcpServers": { "safari": { "command": "uv", "args": ["run", "--script", "/absolute/path/to/safari_mcp.py"] } } }
```

`safari_mcp.py` 和 `pagelib.js` 必须放在同一个文件夹里。

### 一次性权限设置

所有权限都是授给**启动这个服务器的应用**（Claude 或你的终端），不是授给这个脚本。

1. **允许 Apple 事件中的 JavaScript**（几乎所有功能都需要）：Safari → 设置 → 高级 → 勾选“显示网页开发者功能”（*Show features for web developers*）；然后在“开发”菜单里勾选“允许 Apple 事件中的 JavaScript”（*Allow JavaScript from Apple Events*）。这个项目只在英文界面下测过，中文界面里的菜单名称可能与这里写的略有出入，以括号里的英文原名为准。
2. **自动化**：首次使用时 macOS 会询问是否允许宿主应用控制 Safari，之后还会询问 System Events（只用来读取哪个应用在前台，以便把焦点还回去）。两个都点允许。
3. **辅助功能**（系统设置 → 隐私与安全性 → 辅助功能）：`trusted_click`、跨域框、`handle_dialog`、`take_over_tab`、`set_user_agent`、`save_pdf`、`upload_file(method="picker")`、所有 `native_*` 工具，以及 `download_file` / `wait_for_download` 自动应答 Safari 的“是否允许下载”提示，都需要它。
4. **屏幕录制**：只有 `screenshot` 需要。

调用 `doctor` 工具可以看到哪些权限已经就位。

## 工作方式

`snapshot` 返回页面上的可交互元素，每个带一个稳定的引用，比如 `e12`。把引用作为 `click`、`fill` 等工具的 `target`。每次动作之后，服务器会等页面稳定下来，并报告发生了什么（跳转、弹窗、新标签页）。

`target` 可以是引用（`e12`）、CSS 选择器（`#email`）或可见文字（`text=提交`）。选择器和文字匹配能穿透开放的 Shadow DOM 和同源 iframe。以 `x` 开头的引用指向跨域框内部。

`open_url(new_tab=True)` 把页面开在**工作窗口**里：一个独立的 Safari 窗口，创建在你的窗口后面，不会激活 Safari。这个标签页会被固定，之后的调用都作用于它，不管你在自己的窗口里做什么。`take_over_tab` 可以把你已经打开的某个标签页移进这个窗口，页面状态保持不变。

## 工具（66 个）

| 类别 | 工具 |
|---|---|
| 标签页与窗口 | `list_tabs` `use_tab` `open_url` `take_over_tab` `close_tab` `navigate` `wait_for_new_tab` `resize_window` |
| 读取 | `snapshot` `get_page_text` `get_page_source` `run_js` `screenshot` `extract` |
| 检查 | `get_element` `query_all` `get_computed_style` `detect_forms` `verify_fields` `list_frames` `analyze_page` |
| 脚本通道操作 | `click` `fill` `fill_form` `type_text` `press_key` `hover` `scroll` `drag` `wait_for` `wait` |
| 后台可信点击 | `trusted_click` |
| 系统输入 | `native_click` `native_type` `native_key` `native_hover` `native_drag` |
| 组件 | `react_select` `set_editor`（Monaco、CodeMirror、Ace、Quill、ProseMirror 等富文本编辑器） |
| 文件 | `upload_file`（`input` / `drop` / `paste` / `picker`）`download_file` `wait_for_download` `save_pdf` |
| 弹窗 | `handle_dialog` |
| 存储 | `cookies` `storage` `storage_export` `storage_import` `indexed_db` `clipboard` |
| 网络 | `network_requests` `network_capture` `network_details` `http_request` `set_user_agent` `mock_route` `clear_mocks` `throttle_network` |
| 诊断 | `console_messages` `performance_metrics` `css_coverage` `webkit_check` `doctor` |
| 环境模拟 | `emulate` `set_geolocation` |
| 批处理 | `run_steps` |

每个工具都自带说明（英文），你的 MCP 客户端会显示。

## 安全须知

请务必读一遍。这个服务器在设计上就权限很大。

- **它以你的身份行事。** 它操作的是你真实的 Safari 配置，带着你所有已登录的会话。任何工具调用（`click`、`fill`、`run_js`、`http_request`、`download_file` 等）都是以你的身份在当前打开的网站上操作。网页上的文字可能试图指挥 AI 模型（提示注入）；模型一旦照做，就能动你的账号。请搭配会在敏感操作前征求确认的客户端使用，并且不要在登录着重要账号的时候让它访问不可信的网页。
- **弹窗默认确认。** 动作触发的 JavaScript `confirm()` 和 `prompt()` 弹窗会被自动点“好”，包括“确定要删除吗？”这类。`click`、`fill`、`press_key` 可以传 `dialog="dismiss"` 改为取消；其他脚本通道的动作一律确认。弹窗内容会写在工具的返回结果里。
- **下载提示会被自动应答。** `download_file` 或 `wait_for_download` 等待期间，目标窗口里出现的两个按钮的对话框（Safari 的“是否允许此网站下载？”）会被确认。文件名来自网站，会经过清理，下载不会覆盖已有文件。
- **会话数据可能离开你的电脑。** `cookies`、`storage`、`indexed_db`、`storage_export` 和 `network_capture(bodies=True)` 会读取当前网站的 cookie、令牌以及请求和响应内容。这些输出会发给 AI 模型及其服务商。`storage_export` 会把它们写进一个文件（权限 600）：请像对待密码一样对待这个文件。
- **本地文件可能被发给网页。** `upload_file`、`run_js(file=…)` 和 `storage_import` 能读取你的账户可读的任何文件。`open_url` 接受 `file://` 地址。
- **系统输入工具使用你真实的输入设备。** `native_*`、`save_pdf`、`upload_file(method="picker")`、`take_over_tab` 和 `set_user_agent` 会把 Safari 拉到前台；`native_*` 工具还会移动指针和输入文字。`native_key` 发送的是真实快捷键（Cmd+W 会关闭标签页）。`native_type` 会使用剪贴板，用完后恢复原内容。真实点击只会落在目标 Safari 窗口范围内，超出则拒绝。
- **辅助功能权限范围很大。** 它是授给宿主应用的，该应用因此能控制整台 Mac，而不只是 Safari。

密码输入框（`input type=password`）在 `snapshot`、`get_page_text`、`get_element`、`detect_forms` 以及 `fill` / `type_text` 的返回结果里会被打码。在 `run_js` 的结果、`get_page_source`、`screenshot`，以及 `network_capture(bodies=True)` 记录的 fetch/XHR 请求体和响应体里**不会**打码。

## 局限

- **跨域 iframe**：能通过辅助功能接口读取、点击、填写，但无法在里面运行脚本，其中的原生下拉框也无法在后台设值。辅助功能接口只暴露窗口的当前标签页。
- **封闭的 Shadow DOM** 够不着。
- **后台没有可信的按键事件。** 后台窗口收不到系统按键事件。`fill` 产生的是可信的*输入*事件，对大多数网站够用；要求真实按键的网站需要用 `native_key` / `native_type`。
- **`trusted_click` 不带指针移动和坐标。** 画布应用、拖拽手柄和某些自定义组件需要用 `native_click`。
- **网络控制只到页面层。** `mock_route` 和 `throttle_network` 只影响页面发起的 `fetch`/XHR。拦截任意请求、真实限速、读写 HttpOnly cookie，在没有扩展或代理的情况下做不到。`set_user_agent` 是例外：它通过 Safari 的“开发”菜单改变真实的请求头。
- **记录从工具第一次接触页面时开始。** `open_url(capture=True)` 会尽早注入记录器（通常在约 20 毫秒内），但最初几毫秒内执行的内联脚本会漏掉。
- **后台页面处于“不可见”状态。** 浏览器会降低定时器频率并暂停动画帧。普通页面不受影响；视频、部分懒加载和轮播可能需要窗口可见。
- **走菜单的工具依赖界面语言。** `set_user_agent`、`take_over_tab` 和 `save_pdf` 按标题查找 Safari 的菜单项。英文界面测过；中文和日文标题已写入但未验证。
- **`native_key` 假定美式键盘布局**（字母和符号键）。`native_type(method="keys")` 不依赖布局；默认的粘贴方式、`save_pdf` 和 `upload_file(method="picker")` 按美式键位发送 Cmd+V / Cmd+Shift+G。
- **下载文件默认在 `~/Downloads` 里找。** 如果 Safari 存到别处，请给服务器设置环境变量 `SAFARI_MCP_DOWNLOADS`。
- **固定是按位置的**（窗口 ID 加标签页序号）。关闭或移动它左边的标签页后需要重新 `use_tab`。如果被固定的窗口或该位置的标签页不存在了，工具会报错停下，而不会退回到你的前台标签页。如果被固定的标签页被关掉，而同一窗口里它右边还有标签页，固定会指向下一个标签页：请重新调用 `use_tab`。给系统输入工具传 `tab=` 会把固定移到那个标签页。
- 创建工作窗口时，它可能在你的 Safari 窗口前面闪一下，随后被移到后面。
- **服务器重启而页面还开着时**，这些页面会被注入第二份记录器（每次启动服务器都使用一个新的随机属性名，这样网页无法冒充这个库）。上一个服务器进程设置的模拟和延迟会一直生效，直到页面刷新。

## 测试

```bash
uv run --script tests/run_tests.py            # 仅后台部分：不动鼠标键盘，Safari 留在后面
uv run --script tests/run_tests.py --native   # 加上 native_* 的测试
```

测试会在一个后台 Safari 窗口里打开本地测试站点，结束后关闭。加 `--native` 时还会占用鼠标并把 Safari 拉到前台约 40 秒；这部分会等你连续 20 秒没有操作电脑才开始，一直等不到就跳过。下载测试会把文件放进 `~/Downloads` 再移走。

哪些验证过、哪些没有，见 [TESTING.md](TESTING.md)（英文）。

## 相关项目

- [achiya-automation/safari-mcp](https://github.com/achiya-automation/safari-mcp)：一个更大的 Safari MCP 服务器，带可选扩展。
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) 和 [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)：如果你能用 Chrome，它们对浏览器的控制比 Safari 允许的更深。

## 许可

MIT。见 [LICENSE](LICENSE)。
