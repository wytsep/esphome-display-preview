(() => {
  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById("display");
  const status = document.getElementById("status");
  const context = canvas.getContext("2d");

  window.addEventListener("message", event => {
    if (event.data?.type !== "preview") {
      return;
    }
    const preview = event.data.preview;
    canvas.width = preview.width;
    canvas.height = preview.height;
    canvas.hidden = Boolean(preview.error);
    if (!context) {
      canvas.hidden = true;
      status.textContent = "Canvas rendering is unavailable in this Webview.";
      return;
    }
    if (preview.error) {
      status.textContent = [preview.error, ...preview.warnings].join("\n");
      return;
    }

    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.strokeStyle = "black";
    context.lineWidth = 1;
    context.lineCap = "square";
    context.textBaseline = "top";
    for (const command of preview.commands) {
      if (command.kind === "line") {
        if (command.x1 === command.x2 && command.y1 === command.y2) {
          context.fillRect(command.x1, command.y1, 1, 1);
        } else {
          context.beginPath();
          // Center one-pixel strokes on display pixels and include both endpoints.
          context.moveTo(command.x1 + 0.5, command.y1 + 0.5);
          context.lineTo(command.x2 + 0.5, command.y2 + 0.5);
          context.stroke();
        }
      } else if (command.kind === "print") {
        context.font = `${command.fontSize}px sans-serif`;
        context.fillText(command.text, command.x, command.y);
      }
    }
    status.textContent = [
      `Approximation: ${canvas.width} x ${canvas.height}; browser sans-serif, not the configured font. No C++ is executed.`,
      ...preview.warnings
    ].join("\n");
  });

  vscode.postMessage({ type: "ready" });
})();
