'use strict';

/**
 * Guardrails — adapted from OmniRoute
 * (https://github.com/diegosouzapw/OmniRoute, MIT License, Copyright (c) 2026 diegosouzapw).
 * See THIRD_PARTY_NOTICES.md.
 *
 * Ported/merged from open-sse's shared/utils/inputSanitizer.ts, lib/guardrails/
 * (promptInjection.ts, piiMasker.ts, credentialMasker.ts) and shared/utils/
 * injectionSeverity.ts + envBoolean.ts.
 *
 * Three independent checks over a chat-completions style request body
 * (`messages[]` / `input[]` / `system` / `prompt`):
 *
 *   1. Prompt-injection detection  — regex heuristics for "ignore previous
 *      instructions", role-hijack, system-prompt leak attempts, delimiter
 *      injection, jailbreak phrasing, encoding-evasion.
 *   2. PII detection / redaction   — email, CPF/CNPJ, credit card, phone,
 *      SSN. Detection is always on; redaction is opt-in (piiRedaction).
 *   3. Credential/secret masking  — provider API keys, VCS/SaaS tokens,
 *      payment keys, cloud keys, private-key blocks, JWTs, connection
 *      strings, Authorization-style header values — scanned deep through
 *      nested objects/arrays.
 *
 * Everything here defaults to "detect and log" unless explicitly turned on
 * via config/env, so wiring this into an existing request pipeline never
 * changes behavior until it's opted into.
 */

// ─── Prompt injection ──────────────────────────────────────────────────

const MAX_INJECTION_SCAN_BYTES = 16 * 1024;

const INJECTION_PATTERNS = [
  {
    name: 'system_override',
    pattern: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/i,
    severity: 'high',
  },
  {
    name: 'role_hijack',
    pattern: /\b(you\s+are\s+now|act\s+as\s+if|pretend\s+(to\s+be|you\s+are)|from\s+now\s+on\s+you\s+are)\b/i,
    severity: 'medium',
  },
  {
    name: 'system_prompt_leak',
    pattern: /\b(reveals?|shows?|displays?|prints?|outputs?|repeats?)\s+((your|the)\s+)?(system|initial|hidden|original)\s+(prompt|instructions?)/i,
    severity: 'high',
  },
  {
    name: 'delimiter_injection',
    pattern: /(\[SYSTEM\]|\[INST\]|<<SYS>>|<\|im_start\|>|<\|system\|>|<\|user\|>)/i,
    severity: 'high',
  },
  {
    name: 'markdown_system_block',
    pattern: /```+\s*system\b/i,
    severity: 'high',
  },
  {
    name: 'jailbreak_dan',
    pattern: /\b(DAN|do\s+anything\s+now|jailbreak|developer\s+mode|enable\s+developer)\b/i,
    severity: 'medium',
  },
  {
    name: 'encoding_evasion',
    pattern: /\b(base64\s+decode|rot13|hex\s+decode|unicode\s+escape)\b.*\b(instruction|prompt|command)\b/i,
    severity: 'medium',
  },
];

const SEVERITY_SCORES = { low: 1, medium: 2, high: 3 };

function shouldBlockDetections(detections, threshold = 'high') {
  const minimumSeverity = SEVERITY_SCORES[threshold] || SEVERITY_SCORES.high;
  return detections.some((d) => (SEVERITY_SCORES[d.severity || 'high'] || 0) >= minimumSeverity);
}

function resolveBlockThreshold(explicit) {
  const raw = (explicit && String(explicit))
    || process.env.INPUT_SANITIZER_BLOCK_THRESHOLD
    || process.env.INJECTION_GUARD_BLOCK_THRESHOLD
    || 'high';
  const normalized = String(raw).trim().toLowerCase();
  return normalized === 'low' || normalized === 'medium' || normalized === 'high' ? normalized : 'high';
}

function parseEnvBoolean(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function extractMessageContents(body) {
  const contents = [];
  if (!body || typeof body !== 'object') return contents;
  const messageSource = body.messages !== undefined ? body.messages : body.input;
  const messages = Array.isArray(messageSource)
    ? messageSource
    : (messageSource === undefined || messageSource === null ? [] : [messageSource]);
  for (const msg of messages) {
    if (typeof msg === 'string') contents.push(msg);
    else if (msg && typeof msg.content === 'string') contents.push(msg.content);
    else if (msg && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'string') contents.push(part);
        else if (part && part.text) contents.push(part.text);
      }
    }
  }
  if (typeof body.system === 'string') contents.push(body.system);
  else if (Array.isArray(body.system)) {
    for (const s of body.system) {
      if (typeof s === 'string') contents.push(s);
      else if (s && s.text) contents.push(s.text);
    }
  }
  if (typeof body.input === 'string') contents.push(body.input);
  if (typeof body.prompt === 'string') contents.push(body.prompt);
  else if (Array.isArray(body.prompt)) {
    for (const p of body.prompt) if (typeof p === 'string') contents.push(p);
  }
  if (typeof body.instructions === 'string') contents.push(body.instructions);
  return contents;
}

function detectInjection(text, extraPatterns = []) {
  const detections = [];
  const scanText = text.length > MAX_INJECTION_SCAN_BYTES ? text.slice(0, MAX_INJECTION_SCAN_BYTES) : text;
  for (const rule of [...INJECTION_PATTERNS, ...extraPatterns]) {
    const match = scanText.match(rule.pattern);
    if (match) detections.push({ pattern: rule.name, severity: rule.severity, match: match[0].slice(0, 50) });
  }
  return detections;
}

// ─── PII detection / redaction ─────────────────────────────────────────

const PII_PATTERNS = [
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL_REDACTED]' },
  { name: 'cpf', pattern: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, replacement: '[CPF_REDACTED]' },
  { name: 'cnpj', pattern: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, replacement: '[CNPJ_REDACTED]' },
  { name: 'credit_card', pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]' },
  { name: 'phone_br', pattern: /\b\(?\d{2}\)?\s?\d{4,5}-?\d{4}\b/g, replacement: '[PHONE_REDACTED]' },
  { name: 'ssn_us', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN_REDACTED]' },
];

function processPII(text, redact = false) {
  const detections = [];
  let processed = text;
  for (const rule of PII_PATTERNS) {
    const matches = text.match(rule.pattern);
    if (matches && matches.length > 0) {
      detections.push({ type: rule.name, count: matches.length });
      if (redact) processed = processed.replace(rule.pattern, rule.replacement);
    }
  }
  return { text: processed, detections };
}

/** Deep-clone body and PII-redact every message/system/prompt string field. */
function redactBodyPII(body) {
  const clone = JSON.parse(JSON.stringify(body));
  const redactValue = (value) => {
    if (typeof value === 'string') return processPII(value, true).text;
    if (Array.isArray(value)) {
      return value.map((part) => {
        if (typeof part === 'string') return processPII(part, true).text;
        if (part && typeof part === 'object') {
          const next = { ...part };
          if (typeof next.text === 'string') next.text = processPII(next.text, true).text;
          if (typeof next.content === 'string') next.content = processPII(next.content, true).text;
          return next;
        }
        return part;
      });
    }
    return value;
  };

  const messageSource = clone.messages !== undefined ? clone.messages : clone.input;
  const messages = Array.isArray(messageSource) ? messageSource : (messageSource == null ? [] : [messageSource]);
  const redactedMessages = messages.map((msg) => {
    if (typeof msg === 'string') return processPII(msg, true).text;
    if (!msg || typeof msg !== 'object') return msg;
    const next = { ...msg };
    if ('content' in next) next.content = redactValue(next.content);
    if (typeof next.text === 'string') next.text = processPII(next.text, true).text;
    return next;
  });
  if (clone.messages !== undefined) clone.messages = Array.isArray(clone.messages) ? redactedMessages : redactedMessages[0];
  else if (clone.input !== undefined) clone.input = Array.isArray(clone.input) ? redactedMessages : redactedMessages[0];

  if (typeof clone.system === 'string') clone.system = processPII(clone.system, true).text;
  else if (Array.isArray(clone.system)) clone.system = redactValue(clone.system);

  if (typeof clone.prompt === 'string') clone.prompt = processPII(clone.prompt, true).text;
  else if (Array.isArray(clone.prompt)) clone.prompt = clone.prompt.map((e) => (typeof e === 'string' ? processPII(e, true).text : e));

  return clone;
}

// ─── Credential / secret masking ───────────────────────────────────────

const CREDENTIAL_PATTERNS = [
  { name: 'openai_proj', regex: /sk-proj-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED:openai]' },
  { name: 'openai', regex: /\bsk-[A-Za-z0-9]{48}\b/g, replacement: '[REDACTED:openai]' },
  { name: 'anthropic', regex: /sk-ant-api[0-9]?-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED:anthropic]' },
  { name: 'anthropic_alt', regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED:anthropic]' },
  { name: 'google', regex: /AIza[0-9A-Za-z_-]{35}/g, replacement: '[REDACTED:google]' },
  { name: 'huggingface', regex: /hf_[A-Za-z0-9]{34}/g, replacement: '[REDACTED:hf]' },
  { name: 'replicate', regex: /r8_[A-Za-z0-9]{37}/g, replacement: '[REDACTED:replicate]' },
  { name: 'github', regex: /gh[pousr]_[A-Za-z0-9]{36,}/g, replacement: '[REDACTED:github]' },
  { name: 'slack', regex: /xox[bpoa]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED:slack]' },
  { name: 'linear', regex: /lin_api_[A-Za-z0-9]{40}/g, replacement: '[REDACTED:linear]' },
  { name: 'notion', regex: /secret_[A-Za-z0-9]{43}/g, replacement: '[REDACTED:notion]' },
  { name: 'npm', regex: /npm_[A-Za-z0-9]{36}/g, replacement: '[REDACTED:npm]' },
  { name: 'postman', regex: /PMAK-[a-f0-9]{8}-[a-f0-9]{32}/g, replacement: '[REDACTED:postman]' },
  { name: 'discord', regex: /\b[MN][A-Za-z0-9]{23}\.[A-Za-z0-9]{6}\.[A-Za-z0-9]{27}\b/g, replacement: '[REDACTED:discord]' },
  { name: 'stripe', regex: /(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}/g, replacement: '[REDACTED:stripe]' },
  { name: 'square', regex: /sq0(?:atp-[0-9A-Za-z_-]{22}|csp-[0-9A-Za-z_-]{43})/g, replacement: '[REDACTED:square]' },
  { name: 'aws_access_key', regex: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED:aws]' },
  { name: 'twilio', regex: /\bSK[0-9a-fA-F]{32}\b/g, replacement: '[REDACTED:twilio]' },
  { name: 'sendgrid', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, replacement: '[REDACTED:sendgrid]' },
  { name: 'mailgun', regex: /key-[a-f0-9]{32}/g, replacement: '[REDACTED:mailgun]' },
  {
    name: 'private_key',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    replacement: '[REDACTED:private_key]',
  },
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: '[REDACTED:jwt]' },
  {
    name: 'connection_string',
    regex: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^:/@\s"']+:[^:/@\s"']+@/g,
    replacement: '[REDACTED:connection_string]',
  },
  {
    name: 'auth_header',
    regex: /((?:["'\x27]?(?:Authorization|x-api-key|api-key|apikey)["'\x27]?\s*[:=]\s*["'\x27]?)(?:(?:Bearer|Basic|Token)\s+)?)[A-Za-z0-9._~+/=-]{10,}/gi,
    replacement: '$1[REDACTED:auth_header]',
  },
];

function redactCredentials(text) {
  if (typeof text !== 'string' || !text) return { text, detections: [], modified: false };
  let result = text;
  const detections = [];
  for (const p of CREDENTIAL_PATTERNS) {
    p.regex.lastIndex = 0;
    const matches = result.match(p.regex);
    if (matches && matches.length > 0) {
      result = result.replace(p.regex, p.replacement);
      detections.push({ type: p.name, count: matches.length });
    }
  }
  return { text: result, detections, modified: result !== text };
}

/** Deep-walk any JSON-shaped payload, redacting secret-looking strings (values only, not keys). */
function redactCredentialsDeep(value, detections = [], seen = new WeakSet()) {
  if (typeof value === 'string') {
    const r = redactCredentials(value);
    if (r.detections.length) detections.push(...r.detections);
    return { modified: r.modified, value: r.text };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return { modified: false, value };
    seen.add(value);
    let modified = false;
    const next = value.map((item) => {
      const r = redactCredentialsDeep(item, detections, seen);
      modified = modified || r.modified;
      return r.value;
    });
    return { modified, value: modified ? next : value };
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return { modified: false, value };
    seen.add(value);
    let modified = false;
    const next = {};
    for (const [key, entryValue] of Object.entries(value)) {
      const r = redactCredentialsDeep(entryValue, detections, seen);
      modified = modified || r.modified;
      next[key] = r.value;
    }
    return { modified, value: modified ? next : value };
  }
  return { modified: false, value };
}

// ─── Unified entry point ───────────────────────────────────────────────

/**
 * Config shape (all optional, all default to safe/off):
 *   {
 *     enabled: boolean (default false — the whole guardrail layer is opt-in),
 *     injection: { mode: 'log'|'warn'|'block', blockThreshold: 'low'|'medium'|'high' },
 *     piiRedaction: boolean (default false — detect always, redact only if true),
 *     credentialRedaction: boolean (default false),
 *   }
 *
 * Returns { blocked, reason, body, detections: { injection, pii, credentials } }.
 * `body` is the (possibly redacted) request body to actually send upstream —
 * always the original object unless a redaction step decided to change it.
 */
function runGuardrails(body, config = {}, logger = console) {
  const result = {
    blocked: false,
    reason: null,
    body,
    detections: { injection: [], pii: [], credentials: [] },
  };

  if (!config.enabled || !body || typeof body !== 'object') return result;

  const injectionCfg = config.injection || {};
  const mode = injectionCfg.mode || process.env.INJECTION_GUARD_MODE || 'warn';
  const threshold = resolveBlockThreshold(injectionCfg.blockThreshold);
  const contents = extractMessageContents(body);
  const fullText = contents.join('\n');

  const injections = detectInjection(fullText, injectionCfg.customPatterns || []);
  result.detections.injection = injections;
  if (injections.length > 0) {
    const highSeverity = injections.some((d) => d.severity === 'high');
    if (mode === 'block' && shouldBlockDetections(injections, threshold)) {
      logger.warn?.('[guardrails] blocked request: prompt injection detected', injections.map((d) => d.pattern));
      result.blocked = true;
      result.reason = 'prompt_injection';
      return result;
    }
    if (mode !== 'log' || highSeverity) {
      const level = mode === 'log' ? 'info' : 'warn';
      logger[level]?.('[guardrails] prompt injection flagged', injections.map((d) => d.pattern));
    }
  }

  const piiRedaction = parseEnvBoolean(process.env.PII_REDACTION_ENABLED, !!config.piiRedaction);
  const piiResult = processPII(fullText, false);
  result.detections.pii = piiResult.detections;
  let workingBody = body;
  if (piiRedaction && piiResult.detections.length > 0) {
    workingBody = redactBodyPII(workingBody);
    logger.warn?.('[guardrails] PII redacted', piiResult.detections.map((d) => `${d.type}(${d.count})`));
  }

  const credentialRedaction = parseEnvBoolean(process.env.CREDENTIAL_REDACTION_ENABLED, !!config.credentialRedaction);
  if (credentialRedaction) {
    const credDetections = [];
    const { modified, value } = redactCredentialsDeep(workingBody, credDetections);
    result.detections.credentials = credDetections;
    if (modified) {
      workingBody = value;
      logger.warn?.('[guardrails] credentials redacted', credDetections.map((d) => `${d.type}(${d.count})`));
    }
  }

  result.body = workingBody;
  return result;
}

module.exports = {
  // unified entry point
  runGuardrails,
  // prompt injection
  INJECTION_PATTERNS,
  detectInjection,
  extractMessageContents,
  shouldBlockDetections,
  resolveBlockThreshold,
  // PII
  PII_PATTERNS,
  processPII,
  redactBodyPII,
  // credentials
  CREDENTIAL_PATTERNS,
  redactCredentials,
  redactCredentialsDeep,
};
