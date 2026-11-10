# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp>=1.2,<2"]
# ///
"""End-to-end tests for safari_mcp.py against a local fixture site, in the real Safari.
Usage: uv run --script tests/run_tests.py            background tests only: no mouse, no keyboard, Safari stays behind
       uv run --script tests/run_tests.py --native   also the native_* tests: they take the mouse and bring Safari
                                                     forward for ~40 s; they start only once you have been idle 20 s"""
import re, subprocess, sys
NATIVE = "--native" in sys.argv
def idle_seconds():
    out = subprocess.run(["ioreg", "-c", "IOHIDSystem"], capture_output=True, text=True).stdout
    m = re.search(r'"HIDIdleTime" = (\d+)', out)
    return int(m.group(1)) / 1e9 if m else 0.0
import asyncio, hashlib, http.server, json, os, re, sys, tempfile, threading, time
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

HERE = Path(__file__).resolve().parent
SERVER = HERE.parent / "safari_mcp.py"

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(HERE), **k)
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith("/download/"):
            b = b"a,b\n1,2\n" * 2000
            self.send_response(200); self.send_header("Content-Type", "text/csv"); self.send_header("Content-Disposition", 'attachment; filename="report.csv"'); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        if self.path.startswith("/ua"):
            b = (self.headers.get("User-Agent") or "").encode()
            self.send_response(200); self.send_header("Content-Type", "text/plain"); self.send_header("Content-Length", str(len(b))); self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(b); return
        if self.path.startswith("/late.js"):  # an external script that arrives late, like on a real site
            time.sleep(0.3); b = b"console.log('late script log');"
            self.send_response(200); self.send_header("Content-Type", "text/javascript"); self.send_header("Content-Length", str(len(b))); self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(b); return
        super().do_GET()
    def do_POST(self):
        b = json.dumps({"ok": "yes"}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"\n     └─ {detail[:600]}"))

async def main():
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    tmp = Path(tempfile.mkdtemp())
    small = tmp / "small note.txt"; small.write_text("hello upload ✓\n", encoding="utf-8")
    big = tmp / "big.bin"; big.write_bytes(os.urandom(7 * 1024 * 1024 + 123))
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

    async with stdio_client(StdioServerParameters(command="uv", args=["run", "--script", str(SERVER)])) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            timings = {}
            async def call(_tool, **kw):
                t0 = time.time()
                res = await s.call_tool(_tool, kw)
                timings.setdefault(_tool, []).append(time.time() - t0)
                out = "\n".join(c.text if c.type == "text" else f"<{c.type} {len(getattr(c, 'data', ''))}>" for c in res.content)
                return ("ERROR: " if res.isError else "") + out
            async def js(code): return await call("run_js", code=code)
            def ref(snap, pattern):
                m = re.search(r"\[(e\d+)\][^\n]*" + pattern, snap)
                return m.group(1) if m else None

            tools = [t.name for t in (await s.list_tools()).tools]
            print("tools:", ", ".join(tools))
            front0 = re.search(r'"frontmost_app": "([^"]*)"', await call("doctor")).group(1)
            wins0 = len((await call("list_tabs")).split("w")) if False else None
            out = await call("open_url", url=base + "/fixture.html", new_tab=True)
            check("open_url new tab + pin", "SM Fixture" in out and "pinned" in out, out)
            front1 = re.search(r'"frontmost_app": "([^"]*)"', await call("doctor")).group(1)
            lt = await call("list_tabs"); pinned_line = [l for l in lt.splitlines() if "PINNED" in l][0]
            check("agent window: separate window, in the background, no focus change", "agent window" in out and front1 == front0
                  and not pinned_line.startswith("w1 ") and (await js("document.visibilityState")) in ("hidden", "visible"), out + " | " + lt + f" | {front0}->{front1}")
            out = await js("[{a:1},{b:[2,3]}]"); check("run_js as the very first page call returns JSON", out == '[{"a":1},{"b":[2,3]}]', out)
            out = await call("list_tabs"); check("list_tabs shows pin", "PINNED" in out and "fixture.html" in out, out)

            snap = await call("snapshot")
            check("snapshot: headings", "# Fixture page" in snap and "## Form" in snap, snap)
            check("snapshot: labelled textbox", re.search(r'\[e\d+\] textbox "Email"', snap), snap)
            check("snapshot: select options", "options: -- | United States | China" in snap, snap)
            check("snapshot: shadow DOM", '"Shadow button"' in snap and '"Shadow input"' in snap, snap)
            check("snapshot: same-origin iframe", '"Frame input"' in snap and "frame" in snap, snap)
            check("snapshot: hidden file input", re.search(r"\[e\d+\] file .*hidden input", snap), snap)
            check("snapshot: cursor-pointer div", re.search(r'\[e\d+\] clickable "Open card"', snap), snap)
            q = await call("snapshot", query="button")
            check("snapshot: query filter", "Send form" in q and "Email" not in q.split("\n", 2)[2], q)
            full = await call("snapshot", mode="full", query="hover")
            check("snapshot: full mode text", "Hover me" in full, full)

            e_email = ref(snap, 'textbox "Email"')
            out = await call("fill", target=e_email, value="ada@example.org"); check("fill by ref", "ada@example.org" in out, out)
            out = await call("fill", target="#pw", value="s3cret!"); check("fill password masked", "s3cret" not in out and "7 chars" in out, out)
            snap2 = await call("snapshot", query="password"); check("snapshot masks password", "s3cret" not in snap2 and "•••" in snap2, snap2)
            out = await call("get_page_text", target="#pw"); check("get_page_text masks password", "s3cret" not in out and "•••" in out, out)
            out = await call("get_element", target="#pw"); check("get_element masks password", "s3cret" not in out, out)
            out = await call("fill_form", fields=[{"target": "text=Bio", "value": "Line one\nLine two"}, {"target": "#country", "value": "China"},
                                                   {"target": "text=I agree", "value": True}, {"target": "#rb", "value": True}, {"target": "#nope", "value": "x"}])
            check("fill_form: mixed fields + error isolation", 'selected "China"' in out and "checked" in out and "ERROR #nope" in out, out)
            out = await call("press_key", key="Enter", target="#email")
            sub = await js("document.getElementById('submitted').textContent")
            check("press_key Enter submits form", '"email":"ada@example.org"' in sub and '"r":"b"' in sub and "agree=true" in sub and "Line two" in sub, out + " | " + sub)

            out = await call("fill", target="#ctl", value="controlled value")
            await asyncio.sleep(0.2)
            st = await js("[document.getElementById('ctl').value, document.getElementById('mirror').textContent]")
            check("fill: framework-controlled input keeps value", st == '["controlled value","controlled value"]', out + " | " + st)
            out = await call("fill", target="#ctl", value="a__smile __sm"); await asyncio.sleep(0.15); st = await js("document.getElementById('ctl').value")
            check("fill: text containing the library's internal name is typed unchanged", st == "a__smile __sm", out + " | " + st)
            out = await call("wait_for_new_tab", timeout=1.5); check("wait_for_new_tab waits, then reports a timeout", out.startswith("TIMEOUT"), out)
            out = await call("fill", target="#ctl", value=""); await asyncio.sleep(0.15)
            st = await js("document.getElementById('mirror').textContent + '|' + document.getElementById('ctl').value")
            check("fill: clear field", st == "|", out + " | " + st)

            out = await call("type_text", text="Geo", target="#ac")
            st = await js("[document.getElementById('ackeys').textContent, document.querySelectorAll('#sugg li').length]")
            check("type_text: per-key events + suggestions", st == '["3",2]', out + " | " + st)
            out = await call("click", target="text=Geometry")
            st = await js("document.getElementById('ac').value"); check("click by text= on suggestion", st == "Geometry", out + " | " + st)

            out = await call("click", target="text=Open card"); st = await js("document.getElementById('cardout').textContent")
            check("click: coordinates + detail", st == "card:coords:1", out + " | " + st)
            await call("fill", target=ref(snap, 'textbox "Shadow input"'), value="in shadow")
            out = await call("click", target=ref(snap, 'button "Shadow button"')); st = await js("document.getElementById('shadowout').textContent")
            check("shadow DOM: fill + click", st == "shadow:in shadow", out + " | " + st)
            out = await call("fill", target="#inner", value="in frame")
            out2 = await call("click", target="#fb"); st = await js("document.querySelector('iframe').contentDocument.getElementById('fo').textContent")
            check("iframe: fill + click via deep selector", st == "frame:in frame", out + out2 + " | " + st)
            out = await call("fill", target="#ed", value="Rich text here"); st = await js("document.getElementById('edout').textContent")
            check("contenteditable fill", st.strip() == "ed:Rich text here", out + " | " + st)

            out = await call("click", target="#del"); st = await js("document.getElementById('delout').textContent")
            check("confirm accepted by default + reported", st == "deleted" and "Really delete?" in out and "accepted" in out, out + " | " + st)
            out = await call("click", target="#del", dialog="dismiss"); st = await js("document.getElementById('delout').textContent")
            check("confirm dismissed on request", st == "kept" and "dismissed" in out, out + " | " + st)
            out = await call("click", target="#al"); st = await js("document.getElementById('alout').textContent")
            check("alert closed + reported", st == "alerted" and "Heads up" in out, out + " | " + st)

            await call("click", target="#later")
            out = await call("wait_for", text="Late content arrived", timeout=5); check("wait_for text", "condition met" in out, out)
            out = await call("wait_for", selector="#never", timeout=1); check("wait_for timeout reported", "TIMEOUT" in out, out)
            out = await call("click", target="#fx"); st = await js("document.getElementById('fxout').textContent")
            check("click settles after fetch", st == "fx:yes", out + " | " + st)
            out = await call("console_messages"); check("console capture", "fetching now" in out and '{"a":1}' in out and "[warn]" in out, out)
            out = await call("network_requests", filter="echo"); check("network capture", "200 POST fetch" in out, out)

            out = await call("hover", target="#hov"); st = await js("document.getElementById('hovout').textContent"); check("hover", st == "hovered", out)
            out = await call("click", target="#dbl", button="double"); st = await js("document.getElementById('dblout').textContent"); check("double click", st == "dbl", out)
            out = await call("press_key", key="Meta+k"); st = await js("document.getElementById('keys').textContent"); check("key combo", "Meta+k," in st, out + " | " + st)
            out = await call("scroll", direction="bottom"); check("scroll page bottom", "at bottom" in out, out)
            out = await call("scroll", direction="down", amount=300, target="#innerbtn"); check("scroll inner container", "container" in out and "y=300" in out, out)
            out = await call("click", target="#innerbtn"); st = await js("document.getElementById('keys').textContent"); check("click scrolls into view", "INNER," in st, out)

            out = await call("upload_file", paths=[str(small), str(big)], target="text=Choose file")
            await call("wait_for", text="DONE", timeout=20); st = await js("document.getElementById('fileout').textContent")
            check("upload via hidden input: 2 files, 7 MB, hashes match", sha(small) in st and sha(big) in st and "small note.txt" in st and "text/plain" in st, out + " | " + st)
            out = await call("upload_file", paths=[str(small)], target="#file2"); st = await js("document.getElementById('file2out').textContent")
            check("upload: input that the page clears after reading (as GitHub does)", "ERROR" not in out and st.startswith("got:small note.txt:"), out + " | " + st)
            out = await call("upload_file", paths=[str(big)], target="#dz", method="drop")
            await call("wait_for", selector="#dropout", text="big.bin", timeout=20); await asyncio.sleep(0.5)
            st = await js("document.getElementById('dropout').textContent")
            check("upload via drop event: hash matches", sha(big) in st and "handled the drop" in out, out + " | " + st)
            out = await call("upload_file", paths=[str(small)], target="#hov", method="drop")
            check("drop on a non-dropzone warns", "WARNING" in out, out)

            out = await js("await new Promise(r=>setTimeout(()=>r({v:42}),300))"); check("run_js await", out == '{"v":42}', out)
            out = await js("const a=[1,2,3]; return a.map(x=>x*2)"); check("run_js statements", out == "[2,4,6]", out)
            out = await js("nope.nope"); check("run_js error surfaced", "JS error" in out, out)
            out = await call("click", target="e99999"); check("stale/unknown ref error is clear", "ERROR" in out and "snapshot" in out, out)
            out = await call("get_page_text", target="h1"); check("get_page_text target", out.strip() == "Fixture page", out)


            # ---------------- v3 additions: inspection / data
            el = lambda i: f"document.getElementById('{i}').textContent"
            out = await call("get_element", target="#email"); check("get_element", '"tag": "input"' in out and '"visible": true' in out, out)
            out = await call("query_all", selector="form button, #del"); check("query_all", out.startswith("2 match") and "Send form" in out, out)
            out = await call("get_computed_style", target="#card", properties=["cursor"]); check("get_computed_style", '"cursor": "pointer"' in out, out)
            out = await call("detect_forms"); check("detect_forms", "form#f" in out and '"Email"' in out and "•••" in out and "s3cret" not in out, out)
            out = await call("verify_fields", expected=[{"target": "#email", "value": "ada@example.org"}, {"target": "#agree", "value": True}, {"target": "#country", "value": "United States"}])
            check("verify_fields: OK and DIFF", out.count("OK ") == 2 and "DIFF" in out and "2/3 match" in out, out)
            out = await call("extract", kind="tables", target="#tbl"); check("extract tables", "Ada | 90" in out and "Scores" in out, out)
            out = await call("extract", kind="links", filter="page2"); check("extract links", "page2.html" in out and '"total": 2' in out, out)
            out = await call("extract", kind="meta"); check("extract meta", '"title": "SM Fixture"' in out, out)
            out = await call("analyze_page"); check("analyze_page", '"forms": 1' in out and '"sameOriginFrames": 1' in out and '"openShadowRoots": 1' in out, out)
            out = await call("css_coverage"); check("css_coverage", '"usedRules"' in out, out)
            out = await call("list_frames"); check("list_frames", "frame 0" in out and "reachable" in out and "frame.html" in out, out)
            out = await call("run_js", code="document.getElementById('inner').value", frame="0"); check("run_js in frame", out == "in frame", out)
            out = await call("performance_metrics"); check("performance_metrics", '"navigation"' in out and '"domNodes"' in out, out)
            out = await call("webkit_check", kind="all"); check("webkit_check", '"metaViewport": null' in out and '"unsupportedHere"' in out and '"https": false' in out, out[:900])
            out = await call("indexed_db"); check("indexed_db list", out.strip().startswith("["), out)
            await call("snapshot", query="late")
            await js("document.getElementById('latebox').insertAdjacentHTML('beforeend','<button id=newb>Fresh button</button>')")
            out = await call("snapshot", diff=True); check("snapshot diff", "Changes since" in out and '+ [' in out and "Fresh button" in out, out)
            # ---------------- script-driven drag, editors
            out = await call("drag", source="#drag1", target="#drop1"); st = await js(el("dndout")); check("drag: HTML5 drop", st == "dropped:drag1", out + " | " + st)
            out = await call("drag", source="#knob", dx=100); st = await js(el("knobout")); check("drag: pointer slider", st == "knob:100", out + " | " + st)
            out = await call("set_editor", target="#ed", text="Replaced by set_editor"); st = await js(el("edout")); check("set_editor contenteditable", st.strip() == "ed:Replaced by set_editor", out + " | " + st)
            # ---------------- cookies, storage, clipboard
            out = await call("cookies", action="set", name="smtest", value="v1"); out2 = await call("cookies", action="get", name="smtest")
            check("cookies set/get", "set" in out and '"value": "v1"' in out2, out + out2)
            out = await call("cookies", action="delete", name="smtest"); out2 = await call("cookies", action="get", name="smtest"); check("cookies delete", "deleted 1" in out and "smtest" not in out2, out + out2)
            await call("storage", kind="local", action="set", key="smk", value="hello"); out = await call("storage", kind="local", action="get", key="smk"); check("storage set/get", '"value": "hello"' in out, out)
            exp = str(tmp / "state.json"); out = await call("storage_export", path=exp); await call("storage", kind="local", action="clear")
            out2 = await call("storage_import", path=exp); out3 = await call("storage", kind="local", action="get", key="smk")
            check("storage export/import", "saved" in out and "imported" in out2 and '"hello"' in out3, out + out2 + out3)
            await call("storage", kind="local", action="clear")
            old_clip = await call("clipboard", action="read"); await call("clipboard", action="write", text="sm clip ✓"); out = await call("clipboard", action="read")
            await call("clipboard", action="write", text=old_clip); check("clipboard write/read", out == "sm clip ✓", out)
            # ---------------- network capture, mock, throttle
            out = await call("network_capture", bodies=True, clear=True); await call("click", target="#fx")
            lst = await call("network_requests", filter="echo"); m = re.search(r"#(\d+) 200 POST", lst)
            det = await call("network_details", request_id=int(m.group(1))) if m else "no id"
            check("network_details with bodies", '"resBody"' in det and "yes" in det and '"resHeaders"' in det, lst + det)
            out = await call("mock_route", pattern="/api/echo", body='{"ok":"mocked"}'); await call("click", target="#fx"); st = await js(el("fxout"))
            out2 = await call("clear_mocks"); check("mock_route", st == "fx:mocked" and "hits=1" in out2, out + " | " + st + out2)
            await call("throttle_network", latency_ms=700); t0 = time.time(); await call("click", target="#fx"); dt = time.time() - t0
            await call("throttle_network", latency_ms=0); st = await js(el("fxout")); check("throttle_network", dt >= 0.7 and st == "fx:yes", f"{dt:.2f}s {st}")
            out = await call("set_geolocation", latitude=33.7756, longitude=-84.3963)
            st = await js("await new Promise(r=>navigator.geolocation.getCurrentPosition(p=>r(p.coords.latitude+','+p.coords.longitude)))"); check("set_geolocation", st == "33.7756,-84.3963", out + st)
            # ---------------- window, batch, doctor
            out = await call("emulate", device="ipad"); st = await js("navigator.userAgent.includes('iPad')+':'+innerWidth")
            out2 = await call("emulate", device="reset"); st2 = await js("navigator.userAgent.includes('iPad')")
            check("emulate ipad + reset", st == "true:820" and st2 == "false", out + " | " + st + " | " + out2)
            out = await call("wait", seconds=0.2); check("wait", "waited" in out, out)
            out = await call("run_steps", steps=[{"tool": "fill", "args": {"target": "#ctl", "value": "batch"}}, {"tool": "run_js", "args": {"code": "document.getElementById('mirror').textContent"}},
                                                 {"tool": "click", "args": {"target": "#missing"}}, {"tool": "wait", "args": {"seconds": 1}}])
            check("run_steps: runs, reports, stops on error", "[2] run_js: batch" in out and "[3] click: ERROR" in out and "1 step(s) not run" in out, out)
            out = await call("doctor"); check("doctor", '"javascript_from_apple_events": "allowed"' in out and "granted" in out, out)
            # ---------------- trusted clicks in the background (Accessibility; no mouse, no focus change)
            fa = re.search(r'"frontmost_app": "([^"]*)"', await call("doctor")).group(1)
            out = await call("trusted_click", target="#trust"); st = await js(el("trustout"))
            check("trusted_click: trusted event, no id juggling", st == "trusted" and "trusted" in out and "WARNING" not in out, out + " | " + st)
            await js("document.getElementById('submitted').textContent=''")
            out = await call("trusted_click", target="text=Send form"); st = await js(el("submitted")); st2 = await js("document.querySelector('#f button').id")
            check("trusted_click: element without id (temp id removed)", "submitted:" in st and st2 == "", out + " | " + st + " | id=" + repr(st2))
            out = await call("trusted_click", target="text=Open card")
            print("     (trusted_click on a plain div with a click handler: %s)" % out.replace("\n", " ")[:160])
            out = await call("trusted_click", target="#blank"); out2 = await call("wait_for_new_tab", timeout=6)
            out3 = await call("close_tab") if "Page Two" in out2 else "(no new tab)"
            check("trusted_click opens target=_blank in background; close_tab returns the pin", "Page Two" in out2 and "pin returned" in out3 and "SM Fixture" in out3, out + " | " + out2 + " | " + out3)
            fb = re.search(r'"frontmost_app": "([^"]*)"', await call("doctor")).group(1)
            check("background work did not change the frontmost app", fa == fb, f"{fa} -> {fb} (fails if you switched apps yourself meanwhile)")
            # ---------------- cross-origin frame through Accessibility (still in the background)
            snapx = await call("snapshot")
            xr = lambda pat: (re.search(r"\[(x\d+)\][^\n]*" + pat, snapx) or [None, None])[1]
            x_frame, x_name, x_pay, x_chk, x_sel = xr("inside cross-origin frame"), xr('textbox "Card name"'), xr('button "Pay now"'), xr('checkbox "Save card"'), xr("combobox")
            check("snapshot lists cross-origin frame content with x-refs", all([x_frame, x_name, x_pay, x_chk, x_sel]) and "Total due: 42 USD" in snapx, snapx[-900:])
            if all([x_frame, x_name, x_pay, x_chk, x_sel]):
                out = await call("fill", target=x_name, value="Ada"); st = await js(el("xin")); check("frame: fill text (trusted input event)", st == "xin:Ada:true", out + " | " + st)
                out = await call("fill", target=x_chk, value=True); out2 = await call("fill", target=x_sel, value="Mastercard")
                out3 = await call("click", target=x_pay); st = await js(el("xout"))
                check("frame: checkbox + trusted click; native drop-down explains its limit", st == "pay:Ada:true:Visa:true" and "ERROR" in out2 and "native_click" in out2, " | ".join([out, out2, out3, st]))
                out = await call("get_page_text", target=x_frame); check("frame: get_page_text", "Total due: 42 USD" in out and "Payment box" in out, out)
                out = await call("snapshot", query="pay now"); check("frame: snapshot query reaches frame content", 'button "Pay now"' in out, out)
                out = await call("hover", target=x_pay); check("frame: unsupported tool explains itself", "ERROR" in out and "cross-origin frame" in out, out)
            fbx = re.search(r'"frontmost_app": "([^"]*)"', await call("doctor")).group(1)
            check("frame work did not change the frontmost app", fbx == fb, f"{fb} -> {fbx} (fails if you switched apps yourself meanwhile)")
            # ---------------- downloads and raw HTTP
            ddir = tmp / "dl"; ddir.mkdir()
            out = await call("download_file", url=base + "/download/report.csv", save_to=str(ddir), method="fetch")
            f1 = ddir / "report.csv"; check("download_file via in-page fetch", f1.exists() and f1.stat().st_size == 16000, out)
            out = await call("download_file", target="#dl", save_to=str(ddir), method="fetch"); check("download_file from a link target, no overwrite", (ddir / "report (1).csv").exists(), out)
            out = await call("download_file", target="#dl", save_to=str(ddir), method="browser", timeout=25)
            check("download_file via Safari (prompt answered, file moved)", (ddir / "report (2).csv").exists() and "downloaded by Safari" in out, out)
            await call("click", target="#dlblob"); out = await call("wait_for_download", timeout=20, save_to=str(ddir))
            got = sorted(p.name for p in ddir.iterdir()); check("wait_for_download after a click (blob export)", any(n.startswith("blob-export") for n in got), out + " | " + str(got))
            out = await call("http_request", url=base + "/api/echo", method="POST", body="{}"); check("http_request", '"status": 200' in out and "yes" in out, out)
            await js("navigator.sendBeacon('/api/echo','ping')"); out = await call("network_requests", filter="beacon"); check("capture: sendBeacon", "beacon" in out and "/api/echo" in out, out)
            run_native = NATIVE
            if NATIVE:
                t0 = time.time()
                while idle_seconds() < 20 and time.time() - t0 < 240:
                    await asyncio.sleep(2)
                run_native = idle_seconds() >= 20
                print("     native tests: " + ("starting (you have been idle 20 s)" if run_native else "SKIPPED: you kept using the computer for 4 minutes"))
            else:
                print("     native tests: skipped (run with --native while away from the computer)")
            if run_native:
                # ---------------- native layer (real mouse / keyboard, Safari comes to the front)
                out = await call("click", target="#trust"); st = await js(el("trustout")); check("script click is untrusted (baseline)", st == "untrusted", out + st)
                out = await call("native_click", target="#trust"); st = await js(el("trustout")); check("native_click is trusted", st == "trusted" and "trusted" in out and "WARNING" not in out, out + " | " + st)
                out = await call("native_type", text="héllo 小工具", target="#tin"); st = await js(el("tinout")); check("native_type paste (trusted, unicode)", st == "tin:héllo 小工具", out + " | " + st)
                clip = await call("clipboard", action="read"); check("native_type restores clipboard", clip == old_clip, repr(clip[:60]))
                out = await call("native_key", key="Meta+a", target="#tin"); out2 = await call("native_key", key="Backspace"); st = await js("document.getElementById('tin').value+'|'+" + el("tinout"))
                check("native_key combo + Backspace", st == "|tin:", out + out2 + " | " + st)
                out = await call("native_type", text="abc", method="keys"); st = await js(el("tinout")); check("native_type per-key", st == "tin:abc", out + " | " + st)
                out = await call("native_hover", target="#hov"); st = await js(el("hovout")); check("native_hover", st == "hovered", out)
                await js("document.getElementById('knob').style.left='0px'"); out = await call("native_drag", source="#knob", dx=80); st = await js(el("knobout"))
                check("native_drag slider", st.startswith("knob:") and abs(int(st[5:]) - 80) <= 3, out + " | " + st)
                out = await call("click", target="#timerdlg"); await asyncio.sleep(3.6)
                out2 = await call("handle_dialog", action="read"); out3 = await call("handle_dialog", action="accept"); st = await js(el("timerout"))
                check("handle_dialog on a real native confirm", "Timer confirm?" in out2 and "pressed" in out3 and st == "yes", out2 + " | " + out3 + " | " + st)
                out = await call("native_click", target="#blank"); out2 = await call("wait_for_new_tab", timeout=6)
                check("native_click opens target=_blank + wait_for_new_tab", "Page Two" in out2 and "pinned" in out2, out + " | " + out2)
                out = await call("close_tab") if "Page Two" in out2 else "(no new tab)"
                check("pin returns to the fixture tab", "pin returned" in out and "SM Fixture" in out, out)
                if x_name:
                    snapx = await call("snapshot"); x_name = xr('textbox "Card name"')
                    out = await call("native_type", text="Zed", target=x_name); st = await js(el("xin")); check("frame: native_type with the real keyboard", "Zed" in st and st.endswith(":true"), out + " | " + st)
                await js("document.getElementById('fileout').textContent=''")
                out = await call("upload_file", paths=[str(small)], target="text=Choose file", method="picker"); await call("wait_for", text="DONE", timeout=10); st = await js(el("fileout"))
                check("upload via the real file dialog (picker)", sha(small) in st, out + " | " + st)
                out = await call("set_user_agent"); check("set_user_agent lists choices", "iPhone" in out and "Default" in out, out)
                out = await call("set_user_agent", name="iPhone"); ua = await call("http_request", url=base + "/ua")
                check("set_user_agent changes the real header", "iPhone" in out and "iPhone" in ua, out + " | " + ua[:300])
                out = await call("set_user_agent", name="default"); ua = await call("http_request", url=base + "/ua"); check("set_user_agent reset", "iPhone" not in ua and "Macintosh" in ua, out + " | " + ua[:300])
                pdf = tmp / "page.pdf"; out = await call("save_pdf", path=str(pdf)); check("save_pdf", pdf.exists() and pdf.read_bytes()[:4] == b"%PDF", out)
            out = await call("navigate", action="reload", capture=True); out2 = await call("console_messages", contains="log")
            check("early capture sees page-load console output", "recorder injected" in out and "late script log" in out2, out.replace("\n", " ") + " | " + out2.replace("\n", " "))
            print("     (inline boot log captured too: %s)" % ("boot log" in out2))
            e_email = ref(await call("snapshot"), 'textbox "Email"')

            out = await call("click", target="text=Go to page two"); check("click reports navigation", "navigated to: Page Two" in out, out)
            out = await call("click", target=e_email); check("ref invalid after navigation", "ERROR" in out and "new snapshot" in out, out)
            out = await call("navigate", action="back"); check("navigate back", "SM Fixture" in out, out)
            out = await call("screenshot"); check("screenshot window", out.startswith("<image"), out)
            out = await call("screenshot", target="#dz"); check("screenshot element crop", out.startswith("<image"), out)
            out = await call("close_tab"); check("close_tab", "closed" in out, out)
            # ---------------- take over a tab (from a second test-only window; Safari comes forward for ~1 s)
            if run_native:
                await call("open_url", url=base + "/page2.html", new_tab=True)
                await call("open_url", url=base + "/fixture.html", new_tab=True)   # same agent window, tab 2
                lt0 = await call("list_tabs"); await js("window.__keep = 42")
                p0 = [l for l in lt0.splitlines() if "PINNED" in l][0]
                out2 = await call("take_over_tab", tab=p0.split("|")[0].replace("*", "").strip()); lt1 = await call("list_tabs"); keep = await js("window.__keep")
                p1 = [l for l in lt1.splitlines() if "PINNED" in l][0]
                check("take_over_tab: moved to its own window, page state intact", "took over" in out2 and keep == "42" and " t2" in p0[:6] and " t1" in p1[:6] and sum(l.startswith(p1[:3]) for l in lt1.splitlines()) == 1,
                      out2 + " | before: " + p0 + " | after: " + p1 + " | keep=" + keep)
                await call("close_tab")
                for l in (await call("list_tabs")).splitlines():   # close the leftover page2 test tab
                    if "/page2.html" in l and base in l:
                        await call("close_tab", tab=l.split("|")[0].replace("*", "").strip())

            print("\nmedian latency per tool (s):", ", ".join(f"{k}={sorted(v)[len(v)//2]:.2f}" for k, v in sorted(timings.items())))
    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed" + (f"; FAILED: {bad}" if bad else ""))
    sys.exit(1 if bad else 0)

asyncio.run(main())
