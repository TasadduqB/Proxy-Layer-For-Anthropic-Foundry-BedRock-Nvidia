import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderCredentials } from "@/sse/services/auth.js";
import {
  fetchEdgeTtsVoices,
  fetchElevenLabsVoices,
  fetchGeminiVoices,
  fetchLocalDeviceVoices,
} from "open-sse/handlers/ttsProviders/index.js";
import { runWithCredentialsProxy } from "open-sse/utils/proxyFetch.js";

const SUPPORTED_PROVIDERS = new Set([
  "elevenlabs",
  "deepgram",
  "inworld",
  "edge-tts",
  "local-device",
  "gemini",
]);
const NO_AUTH_CATALOGS = new Set(["edge-tts", "local-device", "gemini"]);
const REQUEST_TIMEOUT_MS = 15_000;

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export class VoiceCatalogError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "VoiceCatalogError";
    this.status = status;
  }
}

export function getSupportedVoiceProviders() {
  return [...SUPPORTED_PROVIDERS];
}

function displayLanguage(code) {
  try {
    return languageNames.of(code) || code;
  } catch {
    return code;
  }
}

function displayRegion(code) {
  try {
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

function normalizeLanguage(code) {
  const value = String(code || "en").trim().replace("_", "-");
  return value || "en";
}

function addVoice(byLang, language, voice) {
  const code = normalizeLanguage(language);
  const id = String(voice?.id || "").trim();
  if (!id) return;

  if (!byLang[code]) {
    byLang[code] = { code, name: displayLanguage(code), voices: [] };
  }
  if (byLang[code].voices.some((candidate) => candidate.id === id)) return;

  byLang[code].voices.push({
    id,
    name: String(voice.name || id),
    lang: code,
    gender: String(voice.gender || ""),
    ...(voice.locale ? { locale: String(voice.locale) } : {}),
    ...(voice.country ? { country: String(voice.country) } : {}),
    ...(voice.countryName ? { countryName: String(voice.countryName) } : {}),
    ...(voice.category ? { category: String(voice.category) } : {}),
    ...(voice.free_users_allowed !== undefined
      ? { free_users_allowed: voice.free_users_allowed === true }
      : {}),
  });
}

function finalizeCatalog(byLang) {
  const languages = Object.values(byLang).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const voices = languages.flatMap((language) => language.voices);
  return { voices, languages, byLang };
}

function normalizeEdgeVoices(raw) {
  const byLang = {};
  for (const voice of Array.isArray(raw) ? raw : []) {
    const locale = normalizeLanguage(voice.Locale);
    const [language, country = ""] = locale.split("-");
    addVoice(byLang, language, {
      id: voice.ShortName,
      name: (voice.FriendlyName || voice.ShortName || "")
        .replace("Microsoft ", "")
        .replace(/ Online \(Natural\) - /g, " ("),
      locale,
      country,
      countryName: displayRegion(country || language),
      gender: voice.Gender,
    });
  }
  return finalizeCatalog(byLang);
}

function normalizeLocalVoices(raw) {
  const byLang = {};
  for (const voice of Array.isArray(raw) ? raw : []) {
    const locale = normalizeLanguage(voice.locale);
    const [language, country = ""] = locale.split("-");
    addVoice(byLang, voice.lang || language, {
      id: voice.id,
      name: voice.name,
      locale,
      country: voice.country || country,
      countryName: displayRegion(voice.country || country || language),
      gender: voice.gender,
    });
  }
  return finalizeCatalog(byLang);
}

function normalizeElevenLabsVoices(raw) {
  const byLang = {};
  for (const voice of Array.isArray(raw) ? raw : []) {
    const primaryLanguage = normalizeLanguage(
      voice.labels?.language || voice.lang || "en",
    );
    const normalized = {
      id: voice.voice_id,
      name: voice.name,
      gender: voice.labels?.gender,
      category: voice.category,
      free_users_allowed:
        voice.category === "premade" || voice.is_owner === true,
    };
    addVoice(byLang, primaryLanguage, normalized);
    for (const verified of voice.verified_languages || []) {
      if (verified?.language) addVoice(byLang, verified.language, normalized);
    }
  }
  return finalizeCatalog(byLang);
}

function normalizeDeepgramVoices(data) {
  const byLang = {};
  const models = Array.isArray(data?.tts)
    ? data.tts
    : (Array.isArray(data?.models)
      ? data.models.filter((model) =>
        model?.type === "tts" || model?.category === "tts")
      : []);

  for (const model of models) {
    const id = model.canonical_name || model.name;
    const languages = Array.isArray(model.languages) && model.languages.length
      ? model.languages
      : [id?.split("-").pop() || "en"];
    const gender = model.metadata?.tags?.find((tag) =>
      tag === "masculine" || tag === "feminine") || "";
    for (const language of languages) {
      addVoice(byLang, language, { id, name: model.name || id, gender });
    }
  }
  return finalizeCatalog(byLang);
}

function normalizeInworldVoices(data) {
  const byLang = {};
  for (const voice of Array.isArray(data?.voices) ? data.voices : []) {
    const languages = Array.isArray(voice.languages) && voice.languages.length
      ? voice.languages
      : ["en"];
    for (const language of languages) {
      addVoice(byLang, language, {
        id: voice.voiceId,
        name: voice.displayName || voice.voiceId,
        gender: voice.gender,
      });
    }
  }
  return finalizeCatalog(byLang);
}

async function fetchJson(url, options, providerName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new VoiceCatalogError(
        `${providerName} voice catalogue request failed (${response.status})`,
        502,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new VoiceCatalogError(
        `${providerName} returned an invalid voice catalogue`,
        502,
      );
    }
  } catch (error) {
    if (error instanceof VoiceCatalogError) throw error;
    if (error?.name === "AbortError") {
      throw new VoiceCatalogError(
        `${providerName} voice catalogue request timed out`,
        504,
      );
    }
    throw new VoiceCatalogError(
      `${providerName} voice catalogue request failed`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCredentials(provider) {
  if (NO_AUTH_CATALOGS.has(provider)) return null;
  const credentials = await getProviderCredentials(provider);
  if (credentials?.allRateLimited) {
    throw new VoiceCatalogError(
      `All ${provider} connections are temporarily unavailable`,
      503,
    );
  }
  if (!credentials?.apiKey) {
    throw new VoiceCatalogError(`No ${provider} connection found`, 400);
  }
  return credentials;
}

/** Load and normalize a provider voice catalogue without a server-to-self request. */
export async function getVoiceCatalog(provider) {
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new VoiceCatalogError(
      `provider must be one of: ${getSupportedVoiceProviders().join(", ")}`,
      400,
    );
  }

  const credentials = await loadCredentials(provider);
  return runWithCredentialsProxy(credentials, async () => {
    if (provider === "edge-tts") {
      return normalizeEdgeVoices(await fetchEdgeTtsVoices());
    }
    if (provider === "local-device") {
      return normalizeLocalVoices(await fetchLocalDeviceVoices());
    }
    if (provider === "elevenlabs") {
      return normalizeElevenLabsVoices(
        await fetchElevenLabsVoices(credentials.apiKey),
      );
    }
    if (provider === "gemini") {
      return normalizeElevenLabsVoices(await fetchGeminiVoices());
    }
    if (provider === "deepgram") {
      const data = await fetchJson(
        "https://api.deepgram.com/v1/models",
        { headers: { Authorization: `Token ${credentials.apiKey}` } },
        "Deepgram",
      );
      return normalizeDeepgramVoices(data);
    }

    const data = await fetchJson(
      "https://api.inworld.ai/tts/v1/voices",
      { headers: { Authorization: `Basic ${credentials.apiKey}` } },
      "Inworld",
    );
    return normalizeInworldVoices(data);
  });
}

export function filterVoiceCatalog(catalog, language) {
  if (!language) return catalog;
  const code = normalizeLanguage(language);
  const group = catalog.byLang[code];
  return {
    voices: group?.voices || [],
    languages: group ? [group] : [],
    byLang: group ? { [code]: group } : {},
  };
}

/** Convert the internal catalogue to the OpenAI-compatible voice list shape. */
export function toOpenAiVoiceList(provider, catalog, language = null) {
  const filtered = filterVoiceCatalog(catalog, language);
  const alias = AI_PROVIDERS[provider]?.alias || provider;
  const unique = new Map();

  for (const voice of filtered.voices) {
    const existing = unique.get(voice.id);
    if (existing) {
      if (!existing.languages.includes(voice.lang)) {
        existing.languages.push(voice.lang);
      }
      continue;
    }
    unique.set(voice.id, {
      id: voice.id,
      name: voice.name,
      lang: voice.lang || "",
      languages: [voice.lang].filter(Boolean),
      gender: voice.gender || "",
      model: `${alias}/${voice.id}`,
    });
  }

  return [...unique.values()];
}
