import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createReadFallbackForStaleEdit } from "../../open-sse/utils/editToolArgs.js";

const tempDirs = [];

function tempFile(content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-edit-recovery-"));
  tempDirs.push(directory);
  const filePath = path.join(directory, "SettingsPage.tsx");
  fs.writeFileSync(filePath, content);
  return filePath;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("stale edit recovery", () => {
  it("converts a conflicting stale edit into a targeted Read", () => {
    const current = [
      "const OAuthSection = () => (",
      "  /* OAuth Flow Button */",
      "  <Button onClick={() => connect({ clientId, clientSecret })}>",
      "    Connect",
      "  </Button>",
      ");",
    ].join("\n");
    const stale = [
      "  /* OAuth Flow Button */",
      "  <Button onClick={() => connect()}>",
      "    Connect",
      "  </Button>",
    ].join("\n");
    const filePath = tempFile(`${current}\n`);

    const fallback = createReadFallbackForStaleEdit("Edit", {
      file_path: filePath,
      old_string: stale,
      new_string: "replacement",
    });

    expect(fallback).toMatchObject({
      converted: true,
      name: "Read",
      input: { file_path: filePath },
    });
    expect(fallback.input.offset).toBeGreaterThanOrEqual(1);
    expect(fallback.input.limit).toBeGreaterThanOrEqual(60);
  });

  it("does not convert a stale edit without a unique anchor", () => {
    const filePath = tempFile("value = 1\nvalue = 1\n");
    expect(createReadFallbackForStaleEdit("Edit", {
      file_path: filePath,
      old_string: "value = 1\nmissing = true",
      new_string: "value = 2",
    })).toEqual({ converted: false });
  });

  it("converts an already-applied one-line edit into a targeted Read", () => {
    const filePath = tempFile([
      "{",
      '  "name": "proxy-max-app",',
      '  "version": "2.6.0",',
      "}",
    ].join("\n"));

    expect(createReadFallbackForStaleEdit("Edit", {
      file_path: filePath,
      old_string: '"version": "2.5.0"',
      new_string: '"version": "2.6.0"',
    })).toMatchObject({
      converted: true,
      name: "Read",
      input: {
        file_path: filePath,
        offset: 1,
      },
    });
  });

  it("recognizes an already-applied literal shell variable reference", () => {
    const replacement = '-H "PRIVATE-TOKEN: ${GITLAB_TOKEN:?Set GITLAB_TOKEN}"';
    const filePath = tempFile([
      "```bash",
      'curl -s "https://git.example/api/v4/issues/1" \\',
      `  ${replacement}`,
      "```",
    ].join("\n"));

    const fallback = createReadFallbackForStaleEdit("Update", {
      file_path: filePath,
      old_string: '-H "PRIVATE-TOKEN: stale-placeholder"',
      new_string: replacement,
    });

    expect(fallback).toMatchObject({
      converted: true,
      name: "Read",
      input: { file_path: filePath },
    });
  });

  it("uses a read-only fallback when the applied replacement appears more than once", () => {
    const filePath = tempFile([
      "{",
      '  "version": "2.6.0",',
      '  "packages": { "": { "version": "2.6.0" } }',
      "}",
    ].join("\n"));

    expect(createReadFallbackForStaleEdit("Update", {
      file_path: filePath,
      old_string: '"version": "2.5.0"',
      new_string: '"version": "2.6.0"',
      replace_all: true,
    })).toMatchObject({
      converted: true,
      name: "Read",
      input: { file_path: filePath },
    });
  });

  it("blocks broad package-lock version replacement from touching dependencies", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-edit-recovery-"));
    tempDirs.push(directory);
    const filePath = path.join(directory, "package-lock.json");
    fs.writeFileSync(filePath, [
      "{",
      '  "version": "2.7.0",',
      '  "packages": {',
      '    "": { "version": "2.7.0" },',
      '    "node_modules/example": { "version": "2.7.0" }',
      "  }",
      "}",
    ].join("\n"));

    expect(createReadFallbackForStaleEdit("Edit", {
      file_path: filePath,
      old_string: '"version": "2.7.0"',
      new_string: '"version": "2.8.0"',
      replace_all: true,
    })).toMatchObject({
      converted: true,
      name: "Read",
      input: { file_path: filePath },
    });
  });
});
