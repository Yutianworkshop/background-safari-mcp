# What has been tested

Everything here was run on one machine: macOS 27.2, Safari 27.2, English UI, Apple Silicon, two displays.

## Automated suite

`tests/run_tests.py` against the local fixture site:

- background part: all checks pass
- with `--native`: all checks pass

The suite exercises 62 of the 66 tools. Not covered: `react_select` (checked by hand on react-select.com), `use_tab`, `get_page_source`, `resize_window`.

Selected checks:

- A 7 MB binary uploaded through a hidden file input and through a drop zone arrives with the same SHA-256.
- A button and an input that only accept trusted events: script-driven `click` is rejected; `trusted_click` (background) and `native_click` (foreground) are accepted.
- A cross-origin frame (served from a different origin): text fill, checkbox and click succeed in the background with trusted events.
- Creating the agent window and using `trusted_click` leave the frontmost application unchanged.
- `set_user_agent("iPhone")`: the test server receives an iPhone `User-Agent` header.
- `take_over_tab`: a JavaScript variable set before the move is still there afterwards.
- Password fields are masked in `snapshot`, `get_page_text`, `get_element` and `detect_forms`.

## Checked by hand on live sites

- the-internet.herokuapp.com: upload by file input and by drop; the server confirmed the upload.
- DuckDuckGo: per-key typing triggers autocomplete; fill and Enter runs a search.
- GitHub: snapshot and click-through navigation under a strict Content Security Policy.
- GitHub: this repository was created and its files were uploaded through GitHub's web pages with `fill`, `click` and `upload_file`, in a background window.
- Wikipedia: `native_type` search; snapshot of a page with about 7,600 elements in under 0.1 s.
- MDN live samples (cross-origin, inside shadow DOM): content read and a checkbox set in the background.
- react-select.com: options listed and set.
- CodeMirror 5, Monaco and Ace demo pages: `set_editor`, then content read back.

## Not tested

- Any other macOS or Safari version, Intel Macs, or a non-English Safari UI.
- Sites behind a login (the tool has not yet been used on a real authenticated workflow).
- `upload_file(method="paste")`.
- Quill, Slate, Lexical and Draft.js editors.
- WebSocket recording (no test server).
- Native drop-downs inside cross-origin frames.
- Native clicks at a page zoom other than 100 %.
- The degraded path when *Allow JavaScript from Apple Events* is off.
