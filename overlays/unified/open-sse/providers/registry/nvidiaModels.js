export const NVIDIA_API_BASE_URL = "https://integrate.api.nvidia.com";
export const NVIDIA_CHAT_COMPLETIONS_URL = `${NVIDIA_API_BASE_URL}/v1/chat/completions`;
export const NVIDIA_EMBEDDINGS_URL = `${NVIDIA_API_BASE_URL}/v1/embeddings`;
export const NVIDIA_IMAGE_GENERATIONS_URL = `${NVIDIA_API_BASE_URL}/v1/images/generations`;
export const NVIDIA_MODELS_URL = `${NVIDIA_API_BASE_URL}/v1/models`;

// The public NVIDIA /v1/models response is intentionally kept as a checked-in
// fallback. Runtime discovery remains authoritative, but a transient catalog
// outage must not collapse the provider to four hand-maintained models.
// Snapshot: 2026-08-13 (102 hosted catalog entries).
export const NVIDIA_HOSTED_MODEL_IDS = `
01-ai/yi-large
adept/fuyu-8b
ai21labs/jamba-1.5-large-instruct
aisingapore/sea-lion-7b-instruct
baai/bge-m3
bigcode/starcoder2-15b
databricks/dbrx-instruct
deepseek-ai/deepseek-coder-6.7b-instruct
deepseek-ai/deepseek-v4-flash-0731
google/codegemma-1.1-7b
google/codegemma-7b
google/deplot
google/diffusiongemma-26b-a4b-it
google/gemma-2b
google/gemma-3-12b-it
google/gemma-3-4b-it
google/gemma-4-31b-it
google/recurrentgemma-2b
ibm/granite-3.0-3b-a800m-instruct
ibm/granite-3.0-8b-instruct
ibm/granite-34b-code-instruct
ibm/granite-8b-code-instruct
meta/codellama-70b
meta/llama-3.1-70b-instruct
meta/llama-3.1-8b-instruct
meta/llama-3.2-11b-vision-instruct
meta/llama-3.2-1b-instruct
meta/llama-3.2-3b-instruct
meta/llama-3.2-90b-vision-instruct
meta/llama-3.3-70b-instruct
meta/llama-guard-4-12b
meta/llama2-70b
meta/muse-glimmer-30b
microsoft/kosmos-2
microsoft/phi-3-vision-128k-instruct
microsoft/phi-3.5-moe-instruct
minimaxai/minimax-m3
mistralai/codestral-22b-instruct-v0.1
mistralai/mistral-7b-instruct-v0.3
mistralai/mistral-large
mistralai/mistral-large-2-instruct
mistralai/mistral-nemotron
mistralai/mixtral-8x22b-v0.1
moonshotai/kimi-k2.6
nv-mistralai/mistral-nemo-12b-instruct
nvidia/ai-synthetic-video-detector
nvidia/cosmos-reason2-8b
nvidia/embed-qa-4
nvidia/ising-calibration-1.5-31b
nvidia/llama-3.1-nemoguard-8b-content-safety
nvidia/llama-3.1-nemoguard-8b-topic-control
nvidia/llama-3.1-nemotron-51b-instruct
nvidia/llama-3.1-nemotron-70b-instruct
nvidia/llama-3.1-nemotron-nano-8b-v1
nvidia/llama-3.1-nemotron-nano-vl-8b-v1
nvidia/llama-3.1-nemotron-safety-guard-8b-v3
nvidia/llama-3.1-nemotron-ultra-253b-v1
nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1
nvidia/llama-3.2-nv-embedqa-1b-v1
nvidia/llama-3.3-nemotron-super-49b-v1
nvidia/llama-3.3-nemotron-super-49b-v1.5
nvidia/llama-nemotron-embed-1b-v2
nvidia/llama-nemotron-embed-vl-1b-v2
nvidia/llama3-chatqa-1.5-70b
nvidia/mistral-nemo-minitron-8b-8k-instruct
nvidia/nemoretriever-parse
nvidia/nemotron-3-embed-1b
nvidia/nemotron-3-nano-30b-a3b
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
nvidia/nemotron-3-super-120b-a12b
nvidia/nemotron-3-ultra-550b-a55b
nvidia/nemotron-3.5-content-safety
nvidia/nemotron-3.5-lightning-30b-a3b
nvidia/nemotron-4-340b-instruct
nvidia/nemotron-4-340b-reward
nvidia/nemotron-mini-4b-instruct
nvidia/nemotron-nano-12b-v2-vl
nvidia/nemotron-nano-3-30b-a3b
nvidia/nemotron-parse
nvidia/neva-22b
nvidia/nv-embed-v1
nvidia/nv-embedcode-7b-v1
nvidia/nv-embedqa-e5-v5
nvidia/nv-embedqa-mistral-7b-v2
nvidia/nvclip
nvidia/nvidia-nemotron-nano-9b-v2
nvidia/riva-translate-4b-instruct
nvidia/riva-translate-4b-instruct-v1.1
nvidia/riva-translate-4b-instruct-v2
nvidia/vila
openai/gpt-oss-120b
openai/gpt-oss-20b
poolside/laguna-xs-2.1
snowflake/arctic-embed-l
stepfun-ai/step-3.7-flash
thinkingmachines/inkling
writer/palmyra-creative-122b
writer/palmyra-fin-70b-32k
writer/palmyra-med-70b
writer/palmyra-med-70b-32k
z-ai/glm-5.2
zyphra/zamba2-7b-instruct
`.trim().split(/\s+/);

const NVIDIA_GRPC_ONLY_MODELS = new Map([
  ["nvidia/ai-synthetic-video-detector", {
    endpoint: "grpc.nvcf.nvidia.com:443",
    functionId: "847b6e53-0133-452d-ab85-d7acf3ace723",
    protocol: "grpc",
    reason: "NVIDIA exposes this hosted trial through its gRPC NVCF client, not an OpenAI-compatible REST route.",
  }],
]);

export function isNvidiaEmbeddingModelId(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  return Boolean(id) && (
    /(?:^|[-_/])embed(?:ding|code|qa)?(?:$|[-_/])/.test(id)
    || id === "baai/bge-m3"
    || id === "nvidia/nvclip"
  );
}

export function isNvidiaImageGenerationModelId(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  return /^(?:black-forest-labs\/flux(?:\.|-|\/)|stabilityai\/stable-(?:diffusion|image)|qwen\/qwen-image|google\/imagen)/.test(id);
}

export function classifyNvidiaModel(modelId) {
  const id = String(modelId || "").trim();
  const normalized = id.toLowerCase();
  const grpcOnly = NVIDIA_GRPC_ONLY_MODELS.get(normalized);
  if (grpcOnly) {
    return {
      id,
      kind: "unsupported",
      routable: false,
      ...grpcOnly,
    };
  }
  if (isNvidiaEmbeddingModelId(normalized)) {
    return {
      id,
      kind: "embedding",
      endpoint: NVIDIA_EMBEDDINGS_URL,
      protocol: "https",
      routable: true,
      capabilities: { tools: false },
    };
  }
  if (isNvidiaImageGenerationModelId(normalized)) {
    return {
      id,
      kind: "image",
      endpoint: NVIDIA_IMAGE_GENERATIONS_URL,
      protocol: "https",
      routable: true,
      capabilities: { tools: false, imageOutput: true },
    };
  }
  return {
    id,
    kind: "llm",
    endpoint: NVIDIA_CHAT_COMPLETIONS_URL,
    protocol: "https",
    routable: true,
  };
}

export const NVIDIA_HOSTED_MODELS = NVIDIA_HOSTED_MODEL_IDS.map((id) => classifyNvidiaModel(id));

