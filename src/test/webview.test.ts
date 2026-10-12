import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { getPreviewHtml } from "../webview";

suite("Preview Webview", () => {
  test("uses a nonce CSP and contains no inline executable data", () => {
    const html = getPreviewHtml("https://resource.example/preview.js", "testNonce");
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes("script-src 'nonce-testNonce'"));
    assert.ok(html.includes('nonce="testNonce" src="https://resource.example/preview.js"'));
    assert.ok(!html.includes("unsafe-inline"));
    assert.ok(html.includes('role="status"'));
  });

  test("renders messages on the canvas and clears it on errors", () => {
    const scriptPath = path.join(__dirname, "..", "..", "media", "preview.js");
    assert.ok(fs.existsSync(scriptPath), "The canvas renderer must exist");
    const draws: unknown[][] = [];
    const context = {
      font: "", textBaseline: "", fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "",
      fillRect: (...args: unknown[]) => draws.push(["background", ...args]),
      fillText: (...args: unknown[]) => draws.push(["text", context.font, context.textBaseline, ...args]),
      beginPath: () => draws.push(["beginPath"]),
      moveTo: (...args: unknown[]) => draws.push(["moveTo", ...args]),
      lineTo: (...args: unknown[]) => draws.push(["lineTo", ...args]),
      stroke: () => draws.push(["stroke", context.strokeStyle, context.lineWidth, context.lineCap])
    };
    const canvas = { width: 0, height: 0, hidden: false, getContext: () => context };
    const status = { textContent: "" };
    let receive: ((event: { data: unknown }) => void) | undefined;
    const outbound: unknown[] = [];
    vm.runInNewContext(fs.readFileSync(scriptPath, "utf8"), {
      document: { getElementById: (id: string) => id === "display" ? canvas : status },
      window: { addEventListener: (_name: string, listener: typeof receive) => { receive = listener; } },
      acquireVsCodeApi: () => ({ postMessage: (message: unknown) => outbound.push(message) })
    });
    assert.strictEqual(JSON.stringify(outbound), '[{"type":"ready"}]');
    assert.ok(receive);
    const text = '<script>alert("untrusted")</script>';
    receive({ data: { type: "preview", preview: {
      width: 128, height: 64, commands: [
        { kind: "print", x: 5, y: 7, fontSize: 24, text },
        { kind: "line", x1: 10, y1: 20, x2: 100, y2: 20 },
        { kind: "print", x: 1, y: 2, fontSize: 20, text: "After line" },
        { kind: "line", x1: 4, y1: 4, x2: 4, y2: 4 }
      ], warnings: ["Skipped dynamic call."]
    } } });
    assert.deepStrictEqual([canvas.width, canvas.height, canvas.hidden], [128, 64, false]);
    assert.deepStrictEqual(draws[1], ["text", "24px sans-serif", "top", text, 5, 7]);
    assert.deepStrictEqual(draws.slice(2), [
      ["beginPath"], ["moveTo", 10.5, 20.5], ["lineTo", 100.5, 20.5], ["stroke", "black", 1, "square"],
      ["text", "20px sans-serif", "top", "After line", 1, 2],
      ["background", 4, 4, 1, 1]
    ]);
    assert.match(status.textContent, /Approximation/);
    assert.match(status.textContent, /Skipped dynamic call/);
    receive({ data: { type: "preview", preview: {
      width: 400, height: 300, commands: [], warnings: [], error: "Malformed YAML"
    } } });
    assert.strictEqual(canvas.hidden, true);
    assert.strictEqual(status.textContent, "Malformed YAML");
  });
});
