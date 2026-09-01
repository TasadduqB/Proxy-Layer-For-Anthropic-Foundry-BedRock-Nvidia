import { getComboByName, getModelAliases } from "@/lib/localDb";
import {
  normalizeClientModelName,
  resolveClaudeCodeDefaultModel,
} from "@/sse/services/model";
import { buildModelsList } from "../route.js";
import { toAnthropicModelInfo } from "../modelInfo.js";

// URL slug → service kind(s). `web` covers both webSearch and webFetch.
const KIND_SLUG_MAP = {
  image: ["image"],
  tts: ["tts"],
  stt: ["stt"],
  embedding: ["embedding"],
  "image-to-text": ["imageToText"],
  web: ["webSearch", "webFetch"],
};

const LLM_KIND = "llm";
const CLAUDE_FAMILY_RE = /^claude-(?:opus|sonnet|haiku|fable)(?:-|$)/i;
const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

function decodeModelId(value) {
  if (typeof value !== "string") return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function aliasTargetExists(target) {
  if (typeof target === "string") return target.trim() !== "";
  return Boolean(target && typeof target === "object" && target.provider && target.model);
}

async function findModel(requestedId) {
  const normalizedId = normalizeClientModelName(requestedId);
  if (!normalizedId) return null;

  const models = await buildModelsList([LLM_KIND]);
  const listed = models.find((model) => (
    model?.id === requestedId || model?.id === normalizedId
  ));
  if (listed) return listed;

  const aliases = await getModelAliases();
  const aliasTarget = aliases?.[normalizedId];
  if (aliasTargetExists(aliasTarget)) {
    return {
      id: normalizedId,
      object: "model",
      owned_by: "proxy-max-alias",
    };
  }

  const comboTarget = typeof aliasTarget === "string" && !aliasTarget.includes("/")
    ? aliasTarget
    : normalizedId;
  let combo = await getComboByName(comboTarget);

  // Match message routing: newly introduced Claude family IDs remain usable
  // through the managed fallback even before the static selector is updated.
  if (!combo && CLAUDE_FAMILY_RE.test(normalizedId)) {
    combo = await getComboByName("claude-auto");
  }
  if (combo && Array.isArray(combo.models) && combo.models.length > 0) {
    return {
      id: normalizedId,
      object: "model",
      owned_by: "combo",
    };
  }

  const claudeCodeDefault = await resolveClaudeCodeDefaultModel(normalizedId);
  if (claudeCodeDefault) {
    const providerModelId = `cc/${claudeCodeDefault.model}`;
    return models.find((model) => model?.id === providerModelId) || {
      id: providerModelId,
      object: "model",
      owned_by: "cc",
    };
  }

  return null;
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models/{kind} for Proxy Max capability lists, or
 * GET /v1/models/{model_id} for Anthropic-compatible model validation.
 */
export async function GET(request, { params }) {
  try {
    const { kind } = await params;
    const kindFilter = KIND_SLUG_MAP[kind];

    if (kindFilter) {
      const data = await buildModelsList(kindFilter);
      return Response.json({ object: "list", data }, { headers: CORS_HEADERS });
    }

    const requestedId = decodeModelId(kind);
    const model = await findModel(requestedId);
    if (!model) {
      return Response.json(
        {
          error: {
            message: `Model not found: ${requestedId}`,
            type: "not_found_error",
          },
        },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    return Response.json(
      toAnthropicModelInfo(model, requestedId),
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    console.log("Error fetching model details:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
