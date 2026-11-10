# background-safari-mcp

**English** | [简体中文](README.zh-CN.md)

An MCP server that lets an AI agent work in **your real Safari** — with your existing logins — **without taking over your computer**. It works in a separate background window, does not move your mouse, and does not bring Safari to the front.

No Safari extension to install. macOS only.

> **Status: experimental.** Written in a few days, largely by an AI coding assistant (Claude) under the author's direction, and so far exercised on a single machine (macOS 27.2, Safari 27.2, English UI, Apple Silicon). Expect rough edges. Read the [security notes](#security-notes) before using it.

## Why this exists

Chrome can be driven through its debugging protocol; Safari offers nothing comparable. The tools that do automate Safari either need an extension or take your mouse and keyboard while they work. This server combines three channels so that most work happens out of your way:

| Channel | How | Events trusted? | Your mouse / focus |
|---|---|---|---|
| Script (default) | JavaScript injected through Apple Events | clicks and keys no; `fill` input events yes | untouched |
| Background trusted click | macOS Accessibility API (`AXPress`) on the web element | yes | untouched |
| Native (last resort) | real OS mouse and keyboard events (`CGEvent`) | yes | taken for 1–2 s, Safari comes forward (`native_hover` leaves Safari in front with the pointer on the element) |

Two things it does that are uncommon for Safari automation:

- **Trusted clicks in a hidden window.** `trusted_click` presses the element through Accessibility: the page sees a trusted click, the window can be fully covered, and the pointer never moves.
- **Cross-origin iframes without an extension.** Page scripts cannot reach into a cross-origin frame, but Accessibility can. `snapshot` lists the content of such frames with `x`-refs that `click`, `fill` and `get_page_text` accept.

## Requirements

- macOS with Safari. Tested only on macOS 27.2 / Safari 27.2.
- [uv](https://docs.astral.sh/uv/) on your `PATH` (dependencies are declared inline in the script and fetched on first run).
- An MCP client such as Claude Code or Claude Desktop.

## Install

```bash
git clone https://github.com/Yutianworkshop/background-safari-mcp.git
cd background-safari-mcp
uv run --script safari_mcp.py   # optional: fetches dependencies once; stop it with Ctrl-C
```

Register it with your client. For Claude Code:

```bash
claude mcp add safari -s user -- uv run --script "$(pwd)/safari_mcp.py"
```

For clients configured with JSON:

```json
{ "mcpServers": { "safari": { "command": "uv", "args": ["run", "--script", "/absolute/path/to/safari_mcp.py"] } } }
```

`safari_mcp.py` and `pagelib.js` must stay in the same folder.

### One-time permissions

All permissions are requested for the **app that starts the server** (Claude, or your terminal), not for this script.

1. **JavaScript from Apple Events** (needed by almost everything): Safari → Settings → Advanced → enable *Show features for web developers*; then the Develop menu → *Allow JavaScript from Apple Events*.
2. **Automation**: on first use macOS asks whether the host app may control Safari, and later System Events (used only to read which app is frontmost, so focus can be handed back). Allow both.
3. **Accessibility** (System Settings → Privacy & Security → Accessibility): needed for `trusted_click`, cross-origin frames, `handle_dialog`, `take_over_tab`, `set_user_agent`, `save_pdf`, `upload_file(method="picker")`, all `native_*` tools, and for answering Safari's "allow downloads" prompt in `download_file` / `wait_for_download`.
4. **Screen Recording**: needed for `screenshot` only.

Call the `doctor` tool to see which of these are in place.

## How it works

`snapshot` returns the page's interactive elements, each with a stable ref such as `e12`. Use the ref as the `target` of `click`, `fill` and the other tools. After each action the server waits for the page to settle and reports what happened (navigation, dialogs, new tabs).

A `target` can be a ref (`e12`), a CSS selector (`#email`), or visible text (`text=Submit`). Selectors and text reach through open shadow roots and same-origin iframes. Refs starting with `x` point into cross-origin frames.

`open_url(new_tab=True)` opens the page in the **agent window**: a separate Safari window created behind yours, without activating Safari. The tab is pinned, so later calls keep acting on it whatever you do in your own windows. `take_over_tab` moves a tab you already have open into that window, keeping its page state.

## Tools (66)

| Area | Tools |
|---|---|
| Tabs and windows | `list_tabs` `use_tab` `open_url` `take_over_tab` `close_tab` `navigate` `wait_for_new_tab` `resize_window` |
| Reading | `snapshot` `get_page_text` `get_page_source` `run_js` `screenshot` `extract` |
| Inspection | `get_element` `query_all` `get_computed_style` `detect_forms` `verify_fields` `list_frames` `analyze_page` |
| Script-driven actions | `click` `fill` `fill_form` `type_text` `press_key` `hover` `scroll` `drag` `wait_for` `wait` |
| Background trusted click | `trusted_click` |
| Native input | `native_click` `native_type` `native_key` `native_hover` `native_drag` |
| Widgets | `react_select` `set_editor` (Monaco, CodeMirror, Ace, Quill, ProseMirror and other rich editors) |
| Files | `upload_file` (`input` / `drop` / `paste` / `picker`) `download_file` `wait_for_download` `save_pdf` |
| Dialogs | `handle_dialog` |
| Storage | `cookies` `storage` `storage_export` `storage_import` `indexed_db` `clipboard` |
| Network | `network_requests` `network_capture` `network_details` `http_request` `set_user_agent` `mock_route` `clear_mocks` `throttle_network` |
| Diagnostics | `console_messages` `performance_metrics` `css_coverage` `webkit_check` `doctor` |
| Environment | `emulate` `set_geolocation` |
| Batch | `run_steps` |

Every tool carries its own description; your MCP client shows them.

## Security notes

Please read these. The server is powerful by design.

- **It acts as you.** It drives your real Safari profile with all of your logged-in sessions. Any tool call (`click`, `fill`, `run_js`, `http_request`, `download_file`…) acts with your identity on whatever site is open. Text on a web page can try to instruct the AI model (prompt injection); a model that follows it can act on your accounts. Use it with a client that asks before sensitive actions, and do not point it at untrusted pages while logged in to things that matter.
- **Dialogs are accepted by default.** JavaScript `confirm()` and `prompt()` dialogs raised by an action are answered automatically with OK, including "Are you sure you want to delete…?". `click`, `fill` and `press_key` take `dialog="dismiss"` to cancel instead; the other script-driven actions always accept. The dialog text is reported in the tool result.
- **Download prompts are answered automatically.** While `download_file` or `wait_for_download` is waiting, a two-button dialog in the target window (Safari's "allow downloads on this site?") is confirmed. File names come from the site; they are sanitised, and a download never overwrites an existing file.
- **Session data can leave your machine.** `cookies`, `storage`, `indexed_db`, `storage_export` and `network_capture(bodies=True)` read cookies, tokens and request/response bodies of the current site. Their output goes to the AI model and its provider. `storage_export` writes them to a file (mode 600): treat that file like a password.
- **Local files can be sent to web pages.** `upload_file`, `run_js(file=…)` and `storage_import` read any file your account can read. `open_url` accepts `file://` URLs.
- **Native tools use your real input devices.** `native_*`, `save_pdf`, `upload_file(method="picker")`, `take_over_tab` and `set_user_agent` bring Safari to the front; the `native_*` tools also move the pointer and type. `native_key` sends real shortcuts (Cmd+W closes a tab). `native_type` uses the clipboard and restores it afterwards. Real clicks are refused outside the target Safari window.
- **The Accessibility permission is broad.** It is granted to the host app, and lets that app control your whole Mac, not just Safari.

Password fields (`input type=password`) are masked in what `snapshot`, `get_page_text`, `get_element`, `detect_forms` and the results of `fill` / `type_text` report. They are **not** masked in `run_js` results, `get_page_source`, `screenshot`, or the fetch/XHR bodies recorded by `network_capture(bodies=True)`.

## Limitations

- **Cross-origin iframes:** readable, clickable and fillable through Accessibility, but no script can run inside them, and their native drop-downs cannot be set in the background. Only the current tab of a window is exposed to Accessibility.
- **Closed shadow DOM** is not reachable.
- **No trusted key events in the background.** A background window does not receive OS key events. `fill` produces trusted *input* events, which is enough for most sites; sites that require real key presses need `native_key` / `native_type`.
- **`trusted_click` sends no pointer movement or coordinates.** Canvas apps, drag handles and some custom widgets need `native_click`.
- **Network control is page-level.** `mock_route` and `throttle_network` affect only `fetch`/XHR made by the page. Intercepting arbitrary requests, real bandwidth throttling and HttpOnly cookies are out of reach without an extension or a proxy. `set_user_agent` is the exception: it changes the real request header, through Safari's Develop menu.
- **Recording starts when a tool first touches a document.** `open_url(capture=True)` injects the recorder early (typically within ~20 ms), but inline scripts that run in the first milliseconds are missed.
- **A background page is "hidden".** Browsers slow timers and pause animation frames there. Ordinary pages are unaffected; video, some lazy loading and carousels may need the window visible.
- **Menu-driven tools are language-dependent.** `set_user_agent`, `take_over_tab` and `save_pdf` find Safari menu items by title. English is tested; Chinese and Japanese titles are included but unverified.
- **`native_key` assumes a US keyboard layout** for letter and symbol keys. `native_type(method="keys")` is layout-independent; the default paste method, `save_pdf` and `upload_file(method="picker")` send Cmd+V / Cmd+Shift+G by US key position.
- **Downloads are looked for in `~/Downloads`.** If Safari saves elsewhere, set the `SAFARI_MCP_DOWNLOADS` environment variable for the server.
- **The pin is positional** (window id + tab index). Closing or moving tabs to its left requires `use_tab` again. If the pinned window, or the tab position the pin points to, no longer exists, tools stop with an error rather than falling back to your front tab. If the pinned tab is closed while tabs to its right remain in that window, the pin points at the next tab: call `use_tab` again. Passing `tab=` to a native tool moves the pin to that tab.
- Creating the agent window can flash briefly in front of your Safari window before it is moved behind.
- **Restarting the server while pages stay open** injects a second copy of the recorder into those pages (each server start uses a fresh, random property name so that a page cannot impersonate the library). Mocks and throttling set by the previous server process stay active until the page is reloaded.

## Tests

```bash
uv run --script tests/run_tests.py            # background only: no mouse, no keyboard, Safari stays behind
uv run --script tests/run_tests.py --native   # adds the native_* tests
```

The suite opens a local fixture site in a background Safari window and closes it afterwards. With `--native` it also takes the mouse and brings Safari forward for about 40 seconds; it waits until you have been idle for 20 seconds before starting that part, and skips it if you never are. The download tests place files in `~/Downloads` and move them out again.

What has been verified, and what has not, is listed in [TESTING.md](TESTING.md).

## Related projects

- [achiya-automation/safari-mcp](https://github.com/achiya-automation/safari-mcp): a larger Safari MCP server with an optional extension.
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) and [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp): if you can use Chrome, they have deeper browser control than Safari allows.

## License

MIT. See [LICENSE](LICENSE).
