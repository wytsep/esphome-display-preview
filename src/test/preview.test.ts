import * as assert from "assert";
import { parsePreview } from "../preview";

function configuration(lambda: string, extra = ""): string {
  return `font:
  - id: body
    size: 24
display:
  - platform: waveshare_epaper
    model: gdey042t81
${extra}    lambda: |-
${lambda.split("\n").map(line => `      ${line}`).join("\n")}
`;
}

suite("Display preview parsing", () => {
  test("reads a literal call and configured font size with panel fallback", () => {
    const result = parsePreview(configuration('it.print(10, 20, id(body), "Hello");'));
    assert.deepStrictEqual(result.commands, [{ kind: "print", x: 10, y: 20, fontId: "body", fontSize: 24, text: "Hello" }]);
    assert.deepStrictEqual([result.width, result.height], [400, 300]);
    assert.strictEqual(result.error, undefined);
  });

  test("preserves multiple calls and explicit dimensions", () => {
    const result = parsePreview(configuration(
      'it.print(0, 0, id(body), "First");\nit.print(-2, 40.5, id(body), "Second");',
      "    dimensions:\n      width: 640\n      height: 480\n"
    ));
    assert.deepStrictEqual(result.commands.filter(command => command.kind === "print").map(command => [command.x, command.y, command.text]),
      [[0, 0, "First"], [-2, 40.5, "Second"]]);
    assert.deepStrictEqual([result.width, result.height], [640, 480]);
  });

  test("decodes escaped quotes and backslashes without treating text as code", () => {
    const result = parsePreview(configuration(String.raw`it.print(1, 2, id(body), "Say \"hi\" at C:\\temp");`));
    assert.strictEqual(result.commands.find(command => command.kind === "print")?.text, 'Say "hi" at C:\\temp');
  });

  test("ignores non-literal arguments and reports each skipped call", () => {
    const result = parsePreview(configuration(
      'it.print(x + 1, 0, id(body), "Dynamic");\nit.print(0, 0, id(body), id(sensor).state);\nit.print(0, 0, id(body), "Safe");'
    ));
    assert.deepStrictEqual(result.commands.filter(command => command.kind === "print").map(command => command.text), ["Safe"]);
    assert.strictEqual(result.warnings.length, 2);
  });

  test("does not discover commands inside comments or string literals", () => {
    const result = parsePreview(configuration(String.raw`// it.print(0, 0, id(body), "Comment");
/* it.print(0, 0, id(body), "Block"); */
auto value = "it.print(0, 0, id(body), \"String\");";
auto raw = R"(it.print(0, 0, id(body), "Raw");)";
it.print(1, 2, id(body), "Real");`));
    assert.deepStrictEqual(result.commands.filter(command => command.kind === "print").map(command => command.text), ["Real"]);
  });

  test("shows useful errors for malformed YAML and missing lambdas", () => {
    for (const input of ["display: [", "", "display:\n  - platform: waveshare_epaper", "font: []"]) {
      const result = parsePreview(input);
      assert.ok(result.error);
      assert.deepStrictEqual(result.commands, []);
    }
  });

  test("reports malformed C++ and unsupported-only lambdas rather than success", () => {
    for (const lambda of ['it.print(0, 0, id(body), "Unclosed);', 'it.print(x, 0, id(body), "Dynamic");', "it.fill(COLOR_ON);"]) {
      const result = parsePreview(configuration(lambda));
      assert.ok(result.error);
      assert.deepStrictEqual(result.commands, []);
    }
  });

  test("does not substitute unknown fonts or malformed font sizes", () => {
    const result = parsePreview(configuration('it.print(0, 0, id(missing), "Unknown");'));
    assert.ok(result.error);
    const invalid = parsePreview(configuration('it.print(0, 0, id(body), "Invalid");').replace("size: 24", "size: nope"));
    assert.ok(invalid.error);
  });

  test("accepts ESPHome lambda tags and dimension tuples", () => {
    const yaml = configuration('it.print(0, 0, id(body), "Tagged");', "    dimensions: [128, 64]\n")
      .replace("lambda: |-", "lambda: !lambda |-");
    const result = parsePreview(yaml);
    assert.strictEqual(result.commands.find(command => command.kind === "print")?.text, "Tagged");
    assert.deepStrictEqual([result.width, result.height], [128, 64]);
  });

  test("rejects separated numeric tokens and octal escape sequences", () => {
    for (const lambda of ['it.print(1 2, 0, id(body), "Bad");', String.raw`it.print(0, 0, id(body), "\012");`]) {
      assert.ok(parsePreview(configuration(lambda)).error);
    }
  });

  test("exposes specific parse errors and clears partial commands on malformed input", () => {
    assert.match(parsePreview("display: [").error ?? "", /Malformed YAML/);
    const malformed = parsePreview(configuration('it.print(0, 0, id(body), "Good");\nit.print(0, 0, id(body), "Bad);'));
    assert.match(malformed.error ?? "", /Unterminated C\+\+ string/);
    assert.deepStrictEqual(malformed.commands, []);
  });

  test("rejects invalid pixel sizes instead of silently approximating them", () => {
    for (const size of [0, -1, 0.5, 4097]) {
      const source = configuration('it.print(0, 0, id(body), "Invalid");').replace("size: 24", `size: ${size}`);
      assert.ok(parsePreview(source).error, `Font size ${size} must be rejected`);
    }
  });

  test("does not interpret C++ octal coordinates as decimal", () => {
    assert.ok(parsePreview(configuration('it.print(010, 0, id(body), "Octal");')).error);
  });

  test("previews literal lines without requiring fonts", () => {
    const result = parsePreview(`display:
  - lambda: |-
      it.line(0, 10, 100, 10);
      it.line(-2, +3, 40.5, 60);
      it.line(20, 80, 20, 0);
      it.line(4, 4, 4, 4);
`);
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.commands, [
      { kind: "line", x1: 0, y1: 10, x2: 100, y2: 10 },
      { kind: "line", x1: -2, y1: 3, x2: 40.5, y2: 60 },
      { kind: "line", x1: 20, y1: 80, x2: 20, y2: 0 },
      { kind: "line", x1: 4, y1: 4, x2: 4, y2: 4 }
    ]);
  });

  test("preserves mixed text and line drawing order", () => {
    const result = parsePreview(configuration(
      'it.line(0, 0, 100, 0);\nit.print(10, 20, id(body), "Hello");\nit.line(0, 50, 100, 50);'
    ));
    assert.deepStrictEqual(result.commands, [
      { kind: "line", x1: 0, y1: 0, x2: 100, y2: 0 },
      { kind: "print", x: 10, y: 20, fontId: "body", fontSize: 24, text: "Hello" },
      { kind: "line", x1: 0, y1: 50, x2: 100, y2: 50 }
    ]);
  });

  test("warns about unsupported line arguments while retaining valid calls", () => {
    const result = parsePreview(configuration(`it.line(x, 0, 10, 20);
it.line(0, 0, 1 + 2, 20);
it.line(0, 0, 10, 20, COLOR_ON);
it.line(0, 0, 10);
it.line("0", 0, 10, 20);
it.line(010, 0, 10, 20);
it.line(0, 0, 1e999, 20);
it.line(0, 0, 10, 20);`));
    assert.deepStrictEqual(result.commands, [{ kind: "line", x1: 0, y1: 0, x2: 10, y2: 20 }]);
    assert.strictEqual(result.warnings.length, 7);
    assert.ok(result.warnings.every(warning => warning.includes("Skipped it.line")));
  });

  test("ignores line calls in comments and strings", () => {
    const result = parsePreview(configuration(String.raw`// it.line(0, 0, 10, 20);
/* it.line(0, 0, 10, 20); */
auto text = "it.line(0, 0, 10, 20);";
auto raw = R"(it.line(0, 0, 10, 20);)";
it.line(1, 2, 3, 4);`));
    assert.deepStrictEqual(result.commands, [{ kind: "line", x1: 1, y1: 2, x2: 3, y2: 4 }]);
  });

  test("clears partial drawings when a line argument list is unclosed", () => {
    const result = parsePreview(configuration('it.print(0, 0, id(body), "Hello");\nit.line(0, 0, 10, 20;'));
    assert.match(result.error ?? "", /Unclosed it\.line/);
    assert.deepStrictEqual(result.commands, []);
  });

  test("shows an error for unsupported-only line calls", () => {
    const result = parsePreview(configuration("it.line(x, 0, 10, 20);"));
    assert.ok(result.error);
    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0], /Skipped it\.line/);
  });
});
