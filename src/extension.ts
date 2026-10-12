import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { parsePreview, Preview } from "./preview";
import { getPreviewHtml } from "./webview";

export function activate(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | undefined;
  let ready = false;
  let document = vscode.window.activeTextEditor?.document;

  function refresh() {
    if (!panel || !ready) {
      return;
    }
    const isYaml = document && (document.languageId === "yaml" || /\.ya?ml$/i.test(document.fileName));
    const preview: Preview = isYaml && document ? parsePreview(document.getText()) : {
      width: 400, height: 300, commands: [], warnings: [],
      error: "Open an ESPHome YAML document to preview its display: lambda."
    };
    void panel.webview.postMessage({ type: "preview", preview });
  }

  const command = vscode.commands.registerCommand(
    "esphomeDisplayPreview.open",
    () => {
      if (vscode.window.activeTextEditor) {
        document = vscode.window.activeTextEditor.document;
      }
      if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
        refresh();
        return;
      }
      const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
      panel = vscode.window.createWebviewPanel(
        "esphomeDisplayPreview",
        "ESPHome Display Preview",
        vscode.ViewColumn.Beside,
        { enableScripts: true, localResourceRoots: [mediaRoot] }
      );
      const receive = panel.webview.onDidReceiveMessage((message: unknown) => {
        if (typeof message === "object" && message !== null &&
            "type" in message && message.type === "ready") {
          ready = true;
          refresh();
        }
      });
      const disposed = panel.onDidDispose(() => {
        panel = undefined;
        ready = false;
        receive.dispose();
        disposed.dispose();
      });
      const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "preview.js"));
      panel.webview.html = getPreviewHtml(scriptUri.toString(), randomBytes(16).toString("hex"));
    }
  );

  context.subscriptions.push(
    command,
    vscode.window.onDidChangeActiveTextEditor(editor => {
      // A Webview taking focus has no text editor; keep tracking the source document.
      if (editor) {
        document = editor.document;
        refresh();
      }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document === document) {
        refresh();
      }
    }),
    vscode.workspace.onDidCloseTextDocument(closed => {
      if (closed === document) {
        document = undefined;
        refresh();
      }
    }),
    { dispose: () => { panel?.dispose(); } }
  );
}