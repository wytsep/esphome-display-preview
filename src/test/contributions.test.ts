import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

suite("Preview command contributions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
  const yamlCondition = "editorLangId == yaml || resourceExtname =~ /\\.(yaml|yml)$/i";

  test("offers the existing preview command in YAML editor context menus", () => {
    assert.deepStrictEqual(manifest.contributes.menus?.["editor/context"], [{
      command: "esphomeDisplayPreview.open",
      when: yamlCondition,
      group: "navigation"
    }]);
  });

  test("binds a YAML-editor-only shortcut with a macOS override", () => {
    assert.deepStrictEqual(manifest.contributes.keybindings, [{
      command: "esphomeDisplayPreview.open",
      key: "ctrl+alt+p",
      mac: "cmd+alt+p",
      when: `editorTextFocus && (${yamlCondition})`
    }]);
  });
});
