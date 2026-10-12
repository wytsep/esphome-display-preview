export function getPreviewHtml(scriptUri: string, nonce: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ESPHome Display Preview</title>
    <style nonce="${nonce}">
      body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
      #status { white-space: pre-wrap; }
      canvas { border: 1px solid var(--vscode-panel-border); max-width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <p id="status" role="status" aria-live="polite">Waiting for the active ESPHome YAML document...</p>
    <canvas id="display" width="400" height="300" aria-label="Approximate ESPHome display" hidden></canvas>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
