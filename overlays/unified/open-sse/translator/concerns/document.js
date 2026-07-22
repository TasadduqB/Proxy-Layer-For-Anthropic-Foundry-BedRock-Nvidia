import { fetchUrlWithPolicy } from "../../../src/shared/utils/ssrfGuard.js";
import { encodeDataUri, parseDataUri } from "./image.js";

export const PDF_MIME_TYPE = "application/pdf";
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const PDF_FETCH_TIMEOUT_MS = 10_000;

const HTTP_URL_RE = /^https?:\/\//i;
const BASE64_RE = /^[a-z0-9+/]*={0,2}$/i;
const MIME_TYPE_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

export function normalizeMimeType(value) {
  if (typeof value !== "string") return "";
  return value.split(";", 1)[0].trim().toLowerCase();
}

export function isPdfMimeType(value) {
  return normalizeMimeType(value) === PDF_MIME_TYPE;
}

export function isRemoteDocumentUrl(value) {
  return typeof value === "string" && HTTP_URL_RE.test(value);
}

function looksLikePdfName(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const pathname = isRemoteDocumentUrl(value) ? new URL(value).pathname : value;
    return /\.pdf$/i.test(pathname);
  } catch {
    return false;
  }
}

function inferredMimeType(...hints) {
  for (const hint of hints) {
    const normalized = normalizeMimeType(hint);
    if (MIME_TYPE_RE.test(normalized)) return normalized;
  }
  return hints.some(looksLikePdfName) ? PDF_MIME_TYPE : "";
}

/**
 * Normalize the file object from an OpenAI Chat content block. The returned
 * shape is protocol-neutral and deliberately keeps opaque file IDs opaque.
 */
export function normalizeOpenAIFile(file) {
  if (!file || typeof file !== "object") return null;
  const filename = typeof file.filename === "string" ? file.filename : undefined;
  const explicitMime = file.mime_type ?? file.mimeType;
  const fileData = file.file_data ?? file.fileData;

  if (typeof fileData === "string" && fileData) {
    const parsed = parseDataUri(fileData);
    if (parsed) {
      return {
        type: "base64",
        mimeType: normalizeMimeType(parsed.mimeType) || inferredMimeType(explicitMime, filename),
        data: parsed.base64,
        filename,
      };
    }
    if (isRemoteDocumentUrl(fileData)) {
      return {
        type: "url",
        mimeType: inferredMimeType(explicitMime, filename, fileData),
        url: fileData,
        filename,
      };
    }
    // Responses-compatible clients occasionally send raw base64 rather than a
    // data URI. Accept it only with an explicit/inferred PDF MIME hint.
    const compact = fileData.replace(/\s+/g, "");
    const mimeType = inferredMimeType(explicitMime, filename);
    if (isPdfMimeType(mimeType) && compact.length > 0 && compact.length % 4 === 0 && BASE64_RE.test(compact)) {
      return { type: "base64", mimeType, data: compact, filename };
    }
  }

  const fileUrl = file.file_url ?? file.fileUrl;
  if (isRemoteDocumentUrl(fileUrl)) {
    return {
      type: "url",
      mimeType: inferredMimeType(explicitMime, filename, fileUrl),
      url: fileUrl,
      filename,
    };
  }

  const fileId = file.file_id ?? file.fileId;
  if (typeof fileId === "string" && fileId) {
    return {
      type: "file_id",
      mimeType: inferredMimeType(explicitMime, filename),
      fileId,
      filename,
    };
  }
  return null;
}

export function normalizeClaudeDocument(block) {
  if (block?.type !== "document" || !block.source || typeof block.source !== "object") return null;
  const source = block.source;
  const filename = typeof block.title === "string" ? block.title : undefined;
  const mimeType = inferredMimeType(source.media_type, source.mime_type, source.mimeType, filename, source.url);
  if (source.type === "base64" && typeof source.data === "string" && source.data) {
    return { type: "base64", mimeType, data: source.data, filename };
  }
  if (source.type === "url" && isRemoteDocumentUrl(source.url)) {
    return { type: "url", mimeType, url: source.url, filename };
  }
  const fileId = source.file_id ?? source.fileId;
  if (source.type === "file" && typeof fileId === "string" && fileId) {
    return { type: "file_id", mimeType, fileId, filename };
  }
  return null;
}

export function normalizeGeminiDocumentPart(part) {
  if (!part || typeof part !== "object") return null;
  const inline = part.inlineData ?? part.inline_data;
  if (inline && typeof inline === "object") {
    const mimeType = inferredMimeType(inline.mimeType, inline.mime_type);
    if (typeof inline.data === "string" && inline.data) {
      return { type: "base64", mimeType, data: inline.data };
    }
  }
  const file = part.fileData ?? part.file_data;
  if (file && typeof file === "object") {
    const url = file.fileUri ?? file.file_uri;
    const mimeType = inferredMimeType(file.mimeType, file.mime_type, url);
    if (isRemoteDocumentUrl(url) || (typeof url === "string" && url)) {
      return { type: "url", mimeType, url };
    }
  }
  return null;
}

export function isPdfDocument(source) {
  return !!source && (isPdfMimeType(source.mimeType) || looksLikePdfName(source.filename) || looksLikePdfName(source.url));
}

export function documentToOpenAIFile(source) {
  if (!source) return null;
  const file = {};
  if (source.filename) file.filename = source.filename;
  if (source.mimeType) file.mime_type = normalizeMimeType(source.mimeType);
  if (source.type === "base64") file.file_data = encodeDataUri(source.mimeType || PDF_MIME_TYPE, source.data);
  else if (source.type === "url") file.file_data = source.url;
  else if (source.type === "file_id") file.file_id = source.fileId;
  else return null;
  return { type: "file", file };
}

export function documentToResponsesFile(source) {
  if (!source) return null;
  const file = { type: "input_file" };
  if (source.filename) file.filename = source.filename;
  if (source.type === "base64") file.file_data = encodeDataUri(source.mimeType || PDF_MIME_TYPE, source.data);
  else if (source.type === "url") file.file_url = source.url;
  else if (source.type === "file_id") file.file_id = source.fileId;
  else return null;
  return file;
}

export function documentToClaudeBlock(source) {
  if (!source || !isPdfDocument(source)) return null;
  const mediaType = normalizeMimeType(source.mimeType) || PDF_MIME_TYPE;
  if (source.type === "base64") {
    return { type: "document", source: { type: "base64", media_type: mediaType, data: source.data } };
  }
  if (source.type === "url") {
    return { type: "document", source: { type: "url", url: source.url } };
  }
  if (source.type === "file_id") {
    return { type: "document", source: { type: "file", file_id: source.fileId } };
  }
  return null;
}

export function documentToGeminiPart(source) {
  if (!source || !isPdfDocument(source)) return null;
  const mimeType = normalizeMimeType(source.mimeType) || PDF_MIME_TYPE;
  if (source.type === "base64") return { inlineData: { mimeType, data: source.data } };
  if (source.type === "url") return { fileData: { mimeType, fileUri: source.url } };
  if (source.type === "file_id") return { fileData: { mimeType, fileUri: source.fileId } };
  return null;
}

function hasPdfMagic(buffer) {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("latin1");
  return prefix.includes("%PDF-");
}

/**
 * Safely fetch a public remote PDF and return a normalized base64 source.
 * DNS answers and redirects are checked by the shared SSRF policy; streaming
 * enforces the cap even when Content-Length is absent or dishonest.
 */
export async function fetchPdfAsBase64(rawUrl, options = {}) {
  const requestedMax = Number(options.maxBytes ?? MAX_PDF_BYTES);
  const requestedTimeout = Number(options.timeoutMs ?? PDF_FETCH_TIMEOUT_MS);
  const maxBytes = Number.isFinite(requestedMax) && requestedMax > 0
    ? Math.min(requestedMax, MAX_PDF_BYTES)
    : MAX_PDF_BYTES;
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, 60_000)
    : PDF_FETCH_TIMEOUT_MS;
  const response = await fetchUrlWithPolicy(rawUrl, {
    method: "GET",
    headers: { Accept: "application/pdf,application/octet-stream;q=0.8" },
    signal: options.signal,
  }, {
    timeoutMs,
    maxRedirects: 3,
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
    dispatcherFactory: options.dispatcherFactory,
  });

  if (!response.ok || !response.body) throw new Error("Remote PDF could not be fetched");
  const advertisedSize = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(advertisedSize) && advertisedSize > maxBytes) throw new Error("Remote PDF exceeds the size limit");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* best effort */ }
      throw new Error("Remote PDF exceeds the size limit");
    }
    chunks.push(Buffer.from(value));
  }

  const buffer = Buffer.concat(chunks, total);
  if (!hasPdfMagic(buffer)) throw new Error("Remote file is not a PDF");
  return { type: "base64", mimeType: PDF_MIME_TYPE, data: buffer.toString("base64") };
}
