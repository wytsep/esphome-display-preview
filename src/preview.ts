import { parseDocument } from "yaml";

export interface PrintCommand {
  kind: "print";
  x: number;
  y: number;
  fontId: string;
  fontSize: number;
  text: string;
}

export interface LineCommand {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type DrawCommand = PrintCommand | LineCommand;

export interface Preview {
  width: number;
  height: number;
  commands: DrawCommand[];
  warnings: string[];
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Token {
  value: string;
  kind: "symbol" | "string" | "other";
}

function tokenize(lambda: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < lambda.length;) {
    const rest = lambda.slice(index);
    if (/^\s/.test(rest)) {
      index++;
    } else if (rest.startsWith("//")) {
      const end = lambda.indexOf("\n", index);
      index = end < 0 ? lambda.length : end + 1;
    } else if (rest.startsWith("/*")) {
      const end = lambda.indexOf("*/", index + 2);
      if (end < 0) {
        throw new Error("Unterminated C++ block comment.");
      }
      index = end + 2;
    } else if (/^(?:u8|u|U|L)?R"/.test(rest)) {
      const opening = /^(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(/.exec(rest);
      if (!opening) {
        throw new Error("Malformed C++ raw string.");
      }
      const closing = `)${opening[1]}"`;
      const end = lambda.indexOf(closing, index + opening[0].length);
      if (end < 0) {
        throw new Error("Unterminated C++ raw string.");
      }
      tokens.push({ kind: "other", value: "raw string" });
      index = end + closing.length;
    } else if (rest[0] === '"' || rest[0] === "'") {
      const quote = rest[0];
      let text = "";
      let supported = quote === '"';
      let closed = false;
      index++;
      while (index < lambda.length) {
        const character = lambda[index++];
        if (character === quote) {
          closed = true;
          break;
        }
        if (character === "\n" || character === "\r") {
          throw new Error("Newline in a C++ string literal.");
        }
        if (character === "\\") {
          const escape = lambda[index++];
          const escapes: Record<string, string> = {
            '"': '"', "'": "'", "\\": "\\", "?": "?",
            n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", a: "\x07", "0": "\0"
          };
          if (escape === undefined || !Object.hasOwn(escapes, escape) ||
              (escape === "0" && /[0-7]/.test(lambda[index] ?? ""))) {
            supported = false;
          } else {
            text += escapes[escape];
          }
        } else {
          text += character;
        }
      }
      if (!closed) {
        throw new Error("Unterminated C++ string literal.");
      }
      tokens.push({ kind: supported ? "string" : "other", value: text });
    } else {
      const word = /^(?:[A-Za-z_]\w*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(rest);
      const value = word ? word[0] : rest[0];
      tokens.push({ kind: "symbol", value });
      index += value.length;
    }
  }
  return tokens;
}

function numericArgument(tokens: Token[]): number | undefined {
  if (!tokens.every(token => token.kind === "symbol") ||
      !(tokens.length === 1 || (tokens.length === 2 && /^[+-]$/.test(tokens[0].value)))) {
    return undefined;
  }
  const value = tokens.map(token => token.value).join("");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return undefined;
  }
  if (/^[+-]?0\d+$/.test(value)) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseDrawingCommands(lambda: string, fonts: Map<string, number>, preview: Preview): void {
  const tokens = tokenize(lambda);
  for (let index = 0; index < tokens.length; index++) {
    const start = tokens.slice(index, index + 4);
    if (start.length !== 4 || !start.every(token => token.kind === "symbol") ||
        start[0].value !== "it" || start[1].value !== "." ||
        (start[2].value !== "print" && start[2].value !== "line") || start[3].value !== "(") {
      continue;
    }
    const method = start[2].value;
    const argumentsList: Token[][] = [[]];
    let depth = 1;
    let cursor = index + 4;
    for (; cursor < tokens.length; cursor++) {
      const token = tokens[cursor];
      if (token.kind === "symbol" && token.value === "(") {
        depth++;
      } else if (token.kind === "symbol" && token.value === ")") {
        depth--;
        if (depth === 0) {
          break;
        }
      }
      if (depth === 1 && token.kind === "symbol" && token.value === ",") {
        argumentsList.push([]);
      } else {
        argumentsList[argumentsList.length - 1].push(token);
      }
    }
    if (depth !== 0) {
      throw new Error(`Unclosed it.${method}(...) argument list.`);
    }
    index = cursor;
    if (method === "line") {
      const [x1, y1, x2, y2] = argumentsList.map(numericArgument);
      if (argumentsList.length !== 4 || x1 === undefined || y1 === undefined ||
          x2 === undefined || y2 === undefined) {
        preview.warnings.push("Skipped it.line: expected four numeric literal coordinates (x1, y1, x2, y2).");
      } else {
        preview.commands.push({ kind: "line", x1, y1, x2, y2 });
      }
      continue;
    }
    const [xTokens = [], yTokens = [], fontTokens = [], textTokens = []] = argumentsList;
    const x = numericArgument(xTokens);
    const y = numericArgument(yTokens);
    const fontId = fontTokens[2]?.value;
    const fontIsLiteral = fontTokens.length === 4 &&
      fontTokens.every(token => token.kind === "symbol") &&
      fontTokens[0].value === "id" && fontTokens[1].value === "(" &&
      /^[A-Za-z_]\w*$/.test(fontId) && fontTokens[3].value === ")";
    if (argumentsList.length !== 4 || x === undefined || y === undefined ||
        !fontIsLiteral || textTokens.length !== 1 || textTokens[0].kind !== "string") {
      preview.warnings.push("Skipped it.print: expected numeric x/y, id(font), and one ordinary string literal.");
      continue;
    }
    const fontSize = fonts.get(fontId);
    if (fontSize === undefined) {
      preview.warnings.push(`Skipped it.print: font "${fontId}" has no valid font: configuration.`);
      continue;
    }
    preview.commands.push({ kind: "print", x, y, fontId, fontSize, text: textTokens[0].value });
  }
}

export function parsePreview(source: string): Preview {
  const preview: Preview = { width: 400, height: 300, commands: [], warnings: [] };
  try {
    const document = parseDocument(source, {
      customTags: ["!lambda", "!secret", "!include"].map(tag => ({ tag, resolve: (value: string) => value }))
    });
    if (document.errors.length) {
      throw new Error(`Malformed YAML: ${document.errors.map(error => error.message).join("; ")}`);
    }
    preview.warnings.push(...document.warnings.map(warning => warning.message));
    const configuration: unknown = document.toJS({ maxAliasCount: 100 });
    if (!isRecord(configuration)) {
      throw new Error("Open an ESPHome YAML configuration containing a display: lambda.");
    }
    const displays = Array.isArray(configuration.display) ? configuration.display : [configuration.display];
    const withLambda = displays.filter(isRecord).filter(display => typeof display.lambda === "string");
    const display = withLambda[0];
    if (!display) {
      throw new Error("No display: lambda found. Add a literal display lambda containing it.print(...) or it.line(...).");
    }
    if (withLambda.length > 1) {
      preview.warnings.push("Multiple display lambdas found; previewing only the first.");
    }
    const dimensions = display.dimensions;
    if (dimensions !== undefined) {
      const width = Array.isArray(dimensions) ? dimensions[0] : isRecord(dimensions) ? dimensions.width : undefined;
      const height = Array.isArray(dimensions) ? dimensions[1] : isRecord(dimensions) ? dimensions.height : undefined;
      if (typeof width === "number" && typeof height === "number" &&
          Number.isInteger(width) && Number.isInteger(height) &&
          width > 0 && height > 0 && width <= 4096 && height <= 4096) {
        preview.width = width;
        preview.height = height;
      } else {
        preview.warnings.push("Unsupported display dimensions (expected integers 1-4096); using 400 x 300.");
      }
    }
    const fonts = new Map<string, number>();
    const fontEntries = Array.isArray(configuration.font) ? configuration.font : [configuration.font];
    for (const font of fontEntries) {
      if (!isRecord(font) || typeof font.id !== "string") {
        continue;
      }
      const size = font.size === undefined ? 20 : font.size;
      if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > 4096) {
        preview.warnings.push(`Font "${font.id}" has an unsupported size (expected an integer 1-4096).`);
      } else {
        fonts.set(font.id, size);
      }
    }
    parseDrawingCommands(String(display.lambda), fonts, preview);
    if (!preview.commands.length) {
      preview.error = "No supported it.print(...) or it.line(...) calls found in the display lambda.";
    }
  } catch (error) {
    preview.commands = [];
    preview.error = error instanceof Error ? error.message : String(error);
  }
  return preview;
}
