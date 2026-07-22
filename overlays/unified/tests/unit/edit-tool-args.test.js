import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  findUniqueStaleBlockMatch,
  findUniqueWhitespaceMatch,
  repairEditToolInput,
} from "../../open-sse/utils/editToolArgs.js";
import { isNvidiaChatModelId, isNvidiaClaudeToolModelId } from "../../src/lib/nvidiaCatalog.js";

const tempDirs = [];

function tempFile(content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-max-edit-repair-"));
  tempDirs.push(directory);
  const filePath = path.join(directory, "agents.py");
  fs.writeFileSync(filePath, content);
  return filePath;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Claude edit argument repair", () => {
  it("restores a unique exact slice and carries its base indentation to new_string", () => {
    const filePath = tempFile([
      "async def start_analysis(request):",
      "    analysis_id = str(uuid.uuid4())",
      "    now = datetime.now(timezone.utc).isoformat()",
      "",
      "    _ANALYSIS_SESSIONS[analysis_id] = {",
      "        \"analysis_id\": analysis_id,",
      "    }",
      "",
    ].join("\n"));
    const oldString = [
      "analysis_id = str(uuid.uuid4())",
      "now = datetime.now(timezone.utc).isoformat()",
      "",
      "_ANALYSIS_SESSIONS[analysis_id] = {",
    ].join("\n");

    const result = repairEditToolInput("Update", {
      file_path: filePath,
      old_string: oldString,
      new_string: `user_id = user["id"]\n${oldString}`,
    });

    expect(result.repaired).toBe(true);
    expect(result.input.old_string).toContain("    analysis_id");
    expect(result.input.old_string).toContain("    _ANALYSIS_SESSIONS");
    expect(result.input.new_string).toMatch(/^    user_id/m);
    expect(result.input.new_string).toMatch(/^    analysis_id/m);
  });

  it("refuses ambiguous whitespace-only matches", () => {
    const content = "    value = 1\n\n    value = 1\n";
    expect(findUniqueWhitespaceMatch(content, "value = 1")).toBeNull();
  });

  it("leaves an already exact edit unchanged", () => {
    const filePath = tempFile("    value = 1\n");
    const input = { file_path: filePath, old_string: "    value = 1", new_string: "    value = 2" };
    expect(repairEditToolInput("Edit", input)).toEqual({ input, repaired: false });
  });

  it("repairs the reported stale analysis session block after user fields were inserted", () => {
    const oldString = [
      "analysis_id = str(uuid.uuid4())",
      "now = datetime.now(timezone.utc).isoformat()",
      "",
      "_ANALYSIS_SESSIONS[analysis_id] = {",
      "    \"analysis_id\": analysis_id,",
      "    \"submission_id\": request.submission_id,",
      "    \"status\": \"pending\",",
      "    \"request_data\": {",
      "        \"company_name\": request.company_name,",
      "    },",
      "}",
    ].join("\n");
    const current = [
      "async def start_analysis(request):",
      "    analysis_id = str(uuid.uuid4())",
      "    now = datetime.now(timezone.utc).isoformat()",
      "    user_id = user.get(\"id\")",
      "    user_email = user.get(\"email\")",
      "",
      "    _ANALYSIS_SESSIONS[analysis_id] = {",
      "        \"analysis_id\": analysis_id,",
      "        \"submission_id\": request.submission_id,",
      "        \"status\": \"pending\",",
      "        \"request_data\": {",
      "            \"company_name\": request.company_name,",
      "        },",
      "        \"user_id\": user_id,",
      "        \"user_email\": user_email,",
      "    }",
    ].join("\n");
    const filePath = tempFile(`${current}\n`);

    const result = repairEditToolInput("Update", {
      file_path: filePath,
      old_string: oldString,
      new_string: oldString,
    });

    expect(result.repaired).toBe(true);
    expect(result.input.old_string).toContain("user_id = user.get");
    expect(result.input.old_string).toContain('"user_email": user_email');
  });

  it("refuses ambiguous stale blocks", () => {
    const stale = "alpha = 1\nbeta = 2\ngamma = 3";
    const content = [
      "alpha = 1", "inserted = True", "beta = 2", "gamma = 3",
      "alpha = 1", "inserted = False", "beta = 2", "gamma = 3",
    ].join("\n");
    expect(findUniqueStaleBlockMatch(content, stale)).toBeNull();
  });
});

describe("NVIDIA Claude tool routing", () => {
  it("keeps calibration models visible but excludes them from Claude auto tools", () => {
    const model = "nvidia/ising-calibration-1-35b-a3b";
    expect(isNvidiaChatModelId(model)).toBe(true);
    expect(isNvidiaClaudeToolModelId(model)).toBe(false);
  });

  it.each([
    "deepseek-ai/deepseek-v4-pro",
    "qwen/qwen3-coder-480b-a35b-instruct",
  ])("allows tool-oriented model %s", (model) => {
    expect(isNvidiaClaudeToolModelId(model)).toBe(true);
  });

  it("keeps the confirmed looping Nemotron model visible but out of Claude auto-routing", () => {
    const model = "nvidia/nemotron-3-super-120b-a12b";
    expect(isNvidiaChatModelId(model)).toBe(true);
    expect(isNvidiaClaudeToolModelId(model)).toBe(false);
  });
});
