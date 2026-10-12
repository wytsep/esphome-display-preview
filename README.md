# ESPHome Display Preview

An initial, approximate live preview of literal ESPHome display-lambda text and line commands.

## Usage

Open an ESPHome `.yaml` or `.yml` file (or a document in YAML language mode), then run **ESPHome: Preview Display** from the Command Palette. The preview opens beside the editor and refreshes as you edit, including unsaved changes. It follows the active text document; focusing the preview keeps the last source document selected. Running the command again reuses the preview.

You can also right-click inside the YAML editor and select **ESPHome: Preview Display**, or press **Ctrl+Alt+P** (**Cmd+Alt+P** on macOS). The shortcut is active only while a YAML editor has text focus. To change it or resolve a conflict with another extension, open **Preferences: Open Keyboard Shortcuts** and search for **ESPHome: Preview Display**.

```yaml
font:
  - file: "gfonts://Roboto"
    id: body
    size: 24

display:
  - platform: waveshare_epaper
    model: gdey042t81
    lambda: |-
      it.print(10, 20, id(body), "Hello ESPHome");
      it.line(10, 50, 390, 50);
      it.print(10, 60, id(body), "Say \"hello\" at C:\\temp");
```

## Supported

- `it.print(x, y, id(font), "text")` with decimal numeric literal coordinates, a literal font ID, and one ordinary C++ string literal.
- `it.line(x1, y1, x2, y2)` with four decimal numeric literal coordinates, drawn as a black one-pixel line between the endpoints. Horizontal, vertical, diagonal, reversed, and same-point lines are supported; lines do not require a `font:` section. Dynamic coordinates and the optional color argument are skipped with a warning.
- Multiple calls, in source order. C++ comments, character literals, and raw-string contents are not searched for commands.
- Escaped quotes and backslashes, plus basic escapes such as `\n`, `\r`, and `\t`. Escape characters are decoded but drawn with canvas `fillText`; there is no multiline layout.
- Font IDs and integer pixel sizes (1-4096) from `font:`; a missing size uses ESPHome's default of 20 pixels. Missing fonts or invalid sizes produce warnings and their calls are skipped.
- Explicit `display.dimensions` as `{ width: 128, height: 64 }` or `[128, 64]`. Dimensions must be integers between 1 and 4096. Otherwise the canvas uses **400 x 300**, the fallback for `gdey042t81`.
- Literal `lambda: |` blocks, including `lambda: !lambda |`. ESPHome `!secret` and `!include` tags are read as strings only: no secrets or included files are loaded.
- Visible errors for malformed YAML/literals, absent display lambdas, and no supported calls. Mixed supported/unsupported calls show a preview with warnings.

## Approximation and limitations

This is **not an ESPHome emulator**. Text is black on white, using the browser's sans-serif font at the configured pixel size. The configured font file is not loaded; glyph shapes, metrics, baseline, spacing, and rasterization will differ from the device.

Coordinates start at the display's **top-left**, with x increasing right and y increasing down. Text uses a top baseline and clips at the canvas edge.

Lines and text are drawn together in source order and clipped at the canvas edge. Canvas strokes approximate ESPHome's pixel rasterization: diagonal lines may be antialiased, and fractional coordinates are not truncated to device integers.

No C++ is executed and no expressions are evaluated. Dynamic coordinates or strings, hexadecimal/octal coordinates, substitutions, `printf`, alignment/color overloads, adjacent/prefixed/raw string literals, hexadecimal/octal/Unicode escapes, and drawing commands other than `print` and `line` are unsupported. Control flow, preprocessor directives, and display rotation are not simulated: supported literal calls are drawn in source order even inside branches or loops. A malformed literal or unclosed print/line call clears the preview rather than leaving stale drawings.

Only the first display with a literal lambda is previewed; multiple display lambdas produce a warning. Panel models other than `gdey042t81` are not automatically mapped to dimensions; supply explicit dimensions for an appropriate canvas size.

The Webview receives parsed data via messages, draws text and lines on a canvas, and displays messages with `textContent`. It uses a nonce-based restrictive Content Security Policy; YAML and lambda content is never inserted as HTML or executable JavaScript.

## Development

- `npm test`: existing VS Code extension test runner (includes parser, Webview renderer, and command-lifecycle tests).
- `npm run compile`: type-check, lint, and bundle the extension.
- `npm run package`: type-check, lint, and create the production bundle.

The YAML parser is the only runtime dependency; it is bundled into the extension. The browser renderer is shipped in `media/`.
