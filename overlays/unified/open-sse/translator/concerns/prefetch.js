// Pre-fetch remote image URLs into base64 BEFORE translation, for target
// formats whose upstream providers cannot fetch remote URLs themselves
// (they require inline base64). Runs on the source-format body.
import { FORMATS } from "../formats.js";
import { fetchImageAsBase64, parseDataUri } from "./image.js";
import {
  documentToOpenAIFile,
  fetchPdfAsBase64,
  isPdfDocument,
  normalizeClaudeDocument,
  normalizeGeminiDocumentPart,
  normalizeOpenAIFile,
} from "./document.js";

// Targets that require inline base64 images (cannot accept remote URLs).
const TARGETS_NEED_BASE64 = new Set([
  FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX,
  FORMATS.ANTIGRAVITY, FORMATS.OLLAMA, FORMATS.KIRO,
]);

// These wire protocols cannot safely dereference arbitrary public PDF URLs.
// Claude and Responses can carry URL sources natively, so leave those intact.
const DOCUMENT_TARGETS_NEED_BASE64 = new Set([
  FORMATS.OPENAI,
  FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX,
  FORMATS.ANTIGRAVITY,
]);

function isRemoteUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

// Collect {get,set} accessors for every remote image URL in a source body.
function collectImageRefs(body, sourceFormat) {
  const refs = [];
  const pushOpenAI = (messages) => {
    for (const msg of messages || []) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block?.type === "image_url") {
          const url = typeof block.image_url === "string" ? block.image_url : block.image_url?.url;
          if (isRemoteUrl(url)) refs.push({ get: () => url, set: (v) => {
            if (typeof block.image_url === "string") block.image_url = v; else block.image_url.url = v;
          } });
        }
      }
    }
  };
  const pushGemini = (contents) => {
    for (const c of contents || []) {
      for (const p of c.parts || []) {
        const uri = p?.fileData?.fileUri;
        if (isRemoteUrl(uri)) refs.push({ get: () => uri, part: p });
      }
    }
  };

  switch (sourceFormat) {
    case FORMATS.OPENAI:
    case FORMATS.OLLAMA:
    case FORMATS.KIRO:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
      pushOpenAI(body.messages);
      break;
    case FORMATS.CLAUDE:
      for (const msg of body.messages || []) {
        if (!Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
          if (block?.type === "image" && block.source?.type === "url" && isRemoteUrl(block.source.url)) {
            refs.push({ get: () => block.source.url, claudeBlock: block });
          }
        }
      }
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      pushGemini(body.contents);
      break;
    case FORMATS.ANTIGRAVITY:
      pushGemini(body?.request?.contents);
      break;
    default:
      pushOpenAI(body.messages);
  }
  return refs;
}

/**
 * Replace remote image URLs with base64 data when the target needs inline data.
 * No-op when target accepts remote URLs (e.g. openai, claude) or body has none.
 * @returns {Promise<number>} count of images converted
 */
export async function prefetchRemoteImages(body, sourceFormat, targetFormat, options = {}) {
  if (!body || !TARGETS_NEED_BASE64.has(targetFormat)) return 0;
  const refs = collectImageRefs(body, sourceFormat);
  if (!refs.length) return 0;

  let converted = 0;
  for (const ref of refs) {
    const url = ref.get();
    if (parseDataUri(url)) continue; // already inline
    const fetched = await fetchImageAsBase64(url, options);
    if (!fetched) continue;
    if (ref.set) ref.set(fetched.url);
    else if (ref.part) { delete ref.part.fileData; ref.part.inlineData = { mimeType: fetched.mimeType, data: fetched.url.split(",")[1] }; }
    else if (ref.claudeBlock) ref.claudeBlock.source = { type: "base64", media_type: fetched.mimeType, data: fetched.url.split(",")[1] };
    converted++;
  }
  return converted;
}

function collectDocumentRefs(body, sourceFormat) {
  const refs = [];
  const pushOpenAI = (messages) => {
    for (const msg of messages || []) {
      if (!Array.isArray(msg?.content)) continue;
      for (const block of msg.content) {
        if (block?.type !== "file") continue;
        const source = normalizeOpenAIFile(block.file);
        if (source?.type !== "url" || !isPdfDocument(source)) continue;
        refs.push({ source, apply(fetched) {
          block.file = documentToOpenAIFile({ ...fetched, filename: source.filename }).file;
        } });
      }
    }
  };
  const pushClaude = (messages) => {
    for (const msg of messages || []) {
      if (!Array.isArray(msg?.content)) continue;
      for (const block of msg.content) {
        const source = normalizeClaudeDocument(block);
        if (source?.type !== "url" || !isPdfDocument(source)) continue;
        refs.push({ source, apply(fetched) {
          block.source = { type: "base64", media_type: fetched.mimeType, data: fetched.data };
        } });
      }
    }
  };
  const pushGemini = (contents) => {
    for (const content of contents || []) {
      if (!Array.isArray(content?.parts)) continue;
      for (let index = 0; index < content.parts.length; index += 1) {
        const source = normalizeGeminiDocumentPart(content.parts[index]);
        if (source?.type !== "url" || !isPdfDocument(source)) continue;
        refs.push({ source, apply(fetched) {
          content.parts[index] = { inlineData: { mimeType: fetched.mimeType, data: fetched.data } };
        } });
      }
    }
  };
  const pushResponses = (input) => {
    for (const item of input || []) {
      if (!Array.isArray(item?.content)) continue;
      for (const block of item.content) {
        if (block?.type !== "input_file") continue;
        const source = normalizeOpenAIFile(block);
        if (source?.type !== "url" || !isPdfDocument(source)) continue;
        refs.push({ source, apply(fetched) {
          delete block.file_url;
          delete block.fileUrl;
          block.file_data = `data:${fetched.mimeType};base64,${fetched.data}`;
          if (!block.filename && source.filename) block.filename = source.filename;
        } });
      }
    }
  };

  switch (sourceFormat) {
    case FORMATS.CLAUDE:
      pushClaude(body.messages);
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
      pushGemini(body.contents);
      break;
    case FORMATS.ANTIGRAVITY:
      pushGemini(body?.request?.contents);
      break;
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
    case FORMATS.CODEX:
      pushResponses(body.input);
      break;
    default:
      pushOpenAI(body.messages);
  }
  return refs;
}

/**
 * Inline public remote PDFs for formats that require bytes. A failed or
 * non-PDF fetch rejects the request instead of silently discarding the file or
 * forwarding a URL the target cannot consume.
 */
export async function prefetchRemoteDocuments(body, sourceFormat, targetFormat, options = {}) {
  if (!body || !DOCUMENT_TARGETS_NEED_BASE64.has(targetFormat)) return 0;
  const refs = collectDocumentRefs(body, sourceFormat);
  let converted = 0;
  for (const ref of refs) {
    const fetched = await fetchPdfAsBase64(ref.source.url, options);
    ref.apply(fetched);
    converted += 1;
  }
  return converted;
}
