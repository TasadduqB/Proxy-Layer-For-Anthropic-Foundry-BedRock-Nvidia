import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const SUPPORTED_PLATFORMS = new Set(["darwin", "win32", "linux"]);
const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = [
  "storage.serviceMachineId",
  "storage.machineId",
  "telemetry.machineId",
];

/** Get candidate database paths in priority order for a supported platform. */
function getCandidatePaths(platform) {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(
        home,
        "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
      ),
      join(
        home,
        "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb",
      ),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData =
      process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        appData,
        "Cursor - Insiders",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        localAppData,
        "Programs",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
    ];
  }

  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
}

function normalizeCredential(value) {
  if (typeof value !== "string") return null;

  let normalized = value;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") normalized = parsed;
  } catch {
    // Cursor commonly stores plain strings, which are already usable.
  }

  normalized = normalized.trim();
  return normalized || null;
}

function selectExactValue(rows, keys) {
  const byKey = new Map(rows.map((row) => [row?.key, row?.value]));
  for (const key of keys) {
    const value = normalizeCredential(byKey.get(key));
    if (value) return value;
  }
  return null;
}

function selectFuzzyValue(rows, matcher) {
  for (const row of rows) {
    if (!matcher.test(String(row?.key || ""))) continue;
    const value = normalizeCredential(row?.value);
    if (value) return value;
  }
  return null;
}

function tokensFromRows(exactRows, fuzzyRows = []) {
  return {
    accessToken:
      selectExactValue(exactRows, ACCESS_TOKEN_KEYS) ||
      selectFuzzyValue(fuzzyRows, /(?:access.*token|token.*access)/i),
    machineId:
      selectExactValue(exactRows, MACHINE_ID_KEYS) ||
      selectFuzzyValue(fuzzyRows, /(?:machine.*id|id.*machine)/i),
  };
}

/**
 * Extract tokens with the bundled SQLite driver. Dynamic import keeps this
 * route loadable when a deployment lacks a compatible native binding.
 */
async function extractTokensViaBetterSqlite(dbPath) {
  const imported = await import("better-sqlite3");
  const Database = imported.default || imported;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const keys = [...ACCESS_TOKEN_KEYS, ...MACHINE_ID_KEYS];
    const placeholders = keys.map(() => "?").join(",");
    const exactRows = db
      .prepare(`SELECT key, value FROM itemTable WHERE key IN (${placeholders})`)
      .all(...keys);

    let tokens = tokensFromRows(exactRows);
    if (tokens.accessToken && tokens.machineId) return tokens;

    // Cursor has renamed these keys in older/nightly builds. The fuzzy query
    // is deliberately narrow and values are only returned to the authenticated,
    // loopback-only dashboard route.
    const fuzzyRows = db
      .prepare(
        "SELECT key, value FROM itemTable " +
          "WHERE (lower(key) LIKE '%access%token%' " +
          "OR lower(key) LIKE '%token%access%' " +
          "OR lower(key) LIKE '%machine%id%' " +
          "OR lower(key) LIKE '%id%machine%')",
      )
      .all();
    tokens = tokensFromRows(exactRows, fuzzyRows);
    return tokens;
  } finally {
    db.close();
  }
}

/** Fallback for installations where the native SQLite binding cannot load. */
async function extractTokensViaCLI(dbPath) {
  let successfulQueries = 0;
  let lastQueryError = null;
  const query = async (key) => {
    // Keys are constants owned by this module and the path is passed as an
    // argv element, so neither value is interpreted by a shell.
    const sql = `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`;
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
      timeout: 10000,
    });
    successfulQueries += 1;
    return normalizeCredential(stdout.trim());
  };

  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    try {
      accessToken = await query(key);
      if (accessToken) break;
    } catch (error) {
      lastQueryError = error;
      // A missing key is expected; try the next known key.
    }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    try {
      machineId = await query(key);
      if (machineId) break;
    } catch (error) {
      lastQueryError = error;
      // A missing key is expected; try the next known key.
    }
  }

  if (successfulQueries === 0) {
    throw lastQueryError || new Error("sqlite3 did not execute any queries");
  }

  return { accessToken, machineId };
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}

async function cursorAppearsInstalledOnLinux() {
  try {
    await execFileAsync("which", ["cursor"], { timeout: 5000 });
    return true;
  } catch {
    try {
      await access(
        join(homedir(), ".local/share/applications/cursor.desktop"),
        constants.R_OK,
      );
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect Cursor credentials from the local SQLite database. Dashboard
 * middleware protects this endpoint and limits it to loopback callers.
 */
export async function GET() {
  const platform = process.platform;
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return NextResponse.json(
      { found: false, error: "Unsupported platform" },
      { status: 400 },
    );
  }

  try {
    const candidates = getCandidatePaths(platform);
    let dbPath = null;
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        dbPath = candidate;
        break;
      } catch {
        // Try the next stable/insiders installation path.
      }
    }

    if (!dbPath) {
      return NextResponse.json({
        found: false,
        error:
          `Cursor database not found. Checked locations:\n${candidates.join("\n")}` +
          "\n\nMake sure Cursor IDE is installed and opened at least once.",
      });
    }

    if (platform === "linux" && !(await cursorAppearsInstalledOnLinux())) {
      return NextResponse.json({
        found: false,
        error:
          "Cursor config files were found, but Cursor IDE does not appear " +
          "to be installed. Skipping auto-import.",
      });
    }

    const failures = [];
    let databaseWasReadable = false;

    try {
      const tokens = await extractTokensViaBetterSqlite(dbPath);
      databaseWasReadable = true;
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({ found: true, ...tokens });
      }
    } catch (error) {
      failures.push(`embedded SQLite: ${safeErrorMessage(error)}`);
    }

    try {
      const tokens = await extractTokensViaCLI(dbPath);
      databaseWasReadable = true;
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({ found: true, ...tokens });
      }
    } catch (error) {
      failures.push(`sqlite3 CLI: ${safeErrorMessage(error)}`);
    }

    if (databaseWasReadable) {
      return NextResponse.json({
        found: false,
        windowsManual: platform === "win32",
        dbPath,
        error:
          "Cursor credentials were not present in the local database. " +
          "Please login to Cursor IDE first, then retry auto-import.",
      });
    }

    return NextResponse.json({
      found: false,
      windowsManual: platform === "win32",
      dbPath,
      error:
        `Cursor database was found at ${dbPath}, but could not be opened. ` +
        (failures.join("; ") || "No supported SQLite reader was available."),
    });
  } catch (error) {
    return NextResponse.json(
      { found: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

export const __test__ = {
  getCandidatePaths,
  normalizeCredential,
  tokensFromRows,
};
