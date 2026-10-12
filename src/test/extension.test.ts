import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import * as vm from "vm";
import type { Preview } from "../preview";

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe: (listener: (value: T) => void) => {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    fire: (value: T) => { for (const listener of listeners) { listener(value); } },
    listeners
  };
}

function setup() {
  const source = { value: 'font:\n  - id: body\n    size: 24\ndisplay:\n  - lambda: |-\n      it.print(1, 2, id(body), "Hello");' };
  const document = { languageId: "yaml", fileName: "display.yaml", getText: () => source.value };
  const change = event<{ document: typeof document }>();
  const editor = event<{ document: typeof document } | undefined>();
  const close = event<typeof document>();
  const message = event<{ type: string }>();
  const dispose = event<void>();
  const updates: { type: string; preview: Preview }[] = [];
  const registrations = new Map<string, () => void>();
  const panel = {
    webview: {
      html: "",
      asWebviewUri: () => "https://resource.example/preview.js",
      postMessage: (value: typeof updates[number]) => { updates.push(value); return Promise.resolve(true); },
      onDidReceiveMessage: message.subscribe
    },
    onDidDispose: dispose.subscribe,
    reveal: () => {},
    dispose: () => { dispose.fire(); }
  };
  let panelsCreated = 0;
  const window = {
    activeTextEditor: { document },
    onDidChangeActiveTextEditor: editor.subscribe,
    createWebviewPanel: () => { panelsCreated++; return panel; }
  };
  const host = {
    window,
    workspace: { onDidChangeTextDocument: change.subscribe, onDidCloseTextDocument: close.subscribe },
    commands: {
      registerCommand: (id: string, callback: () => void) => {
        registrations.set(id, callback);
        return { dispose: () => { registrations.delete(id); } };
      }
    },
    ViewColumn: { Beside: 2 },
    Uri: { joinPath: (...parts: unknown[]) => parts.join("/") }
  };
  const extensionPath = path.join(__dirname, "..", "extension.js");
  const localRequire = createRequire(extensionPath);
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(fs.readFileSync(extensionPath, "utf8"), {
    module, exports: module.exports,
    require: (name: string) => name === "vscode" ? host : localRequire(name)
  });
  assert.strictEqual(typeof module.exports.activate, "function");
  const subscriptions: { dispose: () => void }[] = [];
  if (typeof module.exports.activate === "function") {
    module.exports.activate({ subscriptions, extensionUri: "extension" });
  }
  const open = registrations.get("esphomeDisplayPreview.open");
  assert.ok(open, "Existing preview command stays registered");
  return { source, document, change, editor, close, message, panel, updates, open, subscriptions, panelsCreated: () => panelsCreated };
}

suite("Preview command lifecycle", () => {
  test("sends active YAML after Webview readiness and refreshes unsaved changes", () => {
    const extension = setup();
    extension.open();
    extension.message.fire({ type: "ready" });
    assert.strictEqual(extension.updates[0]?.preview.commands.find(command => command.kind === "print")?.text, "Hello");
    extension.editor.fire(undefined);
    extension.source.value = extension.source.value.replace("Hello", "Updated");
    extension.change.fire({ document: extension.document });
    assert.strictEqual(extension.updates.at(-1)?.preview.commands.find(command => command.kind === "print")?.text, "Updated");
    extension.source.value = "display: [";
    extension.change.fire({ document: extension.document });
    assert.match(extension.updates.at(-1)?.preview.error ?? "", /Malformed YAML/);
  });

  test("reuses the panel and clears stale content when another editor or closed document is selected", () => {
    const extension = setup();
    extension.open();
    extension.message.fire({ type: "ready" });
    extension.open();
    assert.strictEqual(extension.panelsCreated(), 1);
    extension.editor.fire({ document: { languageId: "plaintext", fileName: "notes.txt", getText: () => "" } });
    assert.match(extension.updates.at(-1)?.preview.error ?? "", /YAML/);
    extension.editor.fire({ document: extension.document });
    extension.close.fire(extension.document);
    assert.match(extension.updates.at(-1)?.preview.error ?? "", /YAML/);
  });

  test("stops sending updates to a disposed panel", () => {
    const extension = setup();
    extension.open();
    extension.message.fire({ type: "ready" });
    extension.panel.dispose();
    const count = extension.updates.length;
    extension.change.fire({ document: extension.document });
    assert.strictEqual(extension.updates.length, count);
    for (const subscription of extension.subscriptions) {
      subscription.dispose();
    }
    assert.strictEqual(extension.change.listeners.size, 0);
  });
});
