'use strict';

/**
 * Generic OpenAI-compatible provider registry — adapted from OmniRoute
 * (https://github.com/diegosouzapw/OmniRoute, MIT License, Copyright (c) 2026 diegosouzapw).
 * See THIRD_PARTY_NOTICES.md.
 *
 * Auto-generated from OmniRoute's open-sse/config/providers/registry/*
 * (filtered to plain bearer-token, OpenAI-shaped, non-browser/OAuth backends —
 * the subset Proxy-Max's src/providers/openai_compat.js can call directly).
 *
 * Each entry: { id, alias, baseUrl, authHeader, defaultContextLength,
 *               passthroughModels, models: [{ id, name, contextLength?, ... }] }
 *
 * `passthroughModels: true` means the provider accepts arbitrary model ids —
 * the listed models are just a curated starting menu, not an exhaustive list.
 */

const REGISTRY = {
  "aimlapi": {
    "id": "aimlapi",
    "alias": "aiml",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.aimlapi.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "gpt-4o",
        "name": "GPT-4o (via AI/ML API)"
      },
      {
        "id": "claude-3-5-sonnet-20241022",
        "name": "Claude 3.5 Sonnet (via AI/ML API)"
      },
      {
        "id": "gemini-1.5-pro",
        "name": "Gemini 1.5 Pro (via AI/ML API)"
      },
      {
        "id": "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
        "name": "Llama 3.1 70B (via AI/ML API)"
      },
      {
        "id": "deepseek-chat",
        "name": "DeepSeek Chat (via AI/ML API)"
      },
      {
        "id": "mistral-large-latest",
        "name": "Mistral Large (via AI/ML API)"
      }
    ]
  },
  "ollama-cloud": {
    "id": "ollama-cloud",
    "alias": "ollamacloud",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://ollama.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "gpt-oss:20b",
        "name": "GPT-OSS 20B",
        "supportsReasoning": true
      },
      {
        "id": "gpt-oss:120b",
        "name": "GPT-OSS 120B",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "supportsReasoning": true
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1",
        "supportsReasoning": true
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2",
        "supportsReasoning": true
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3",
        "contextLength": 1048576,
        "supportsVision": true
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "gemma4:31b",
        "name": "Gemma 4 31B"
      },
      {
        "id": "nemotron-3-super",
        "name": "NVIDIA Nemotron 3 Super"
      },
      {
        "id": "qwen3.5:397b",
        "name": "Qwen 3.5 397B"
      }
    ]
  },
  "synthetic": {
    "id": "synthetic",
    "alias": "synthetic",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.synthetic.new/openai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "hf:openai/gpt-oss-120b",
        "name": "openai/gpt-oss-120b",
        "contextLength": 131072,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "hf:zai-org/GLM-5.2",
        "name": "zai-org/GLM-5.2",
        "contextLength": 524288,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "hf:moonshotai/Kimi-K2.7-Code",
        "name": "moonshotai/Kimi-K2.7-Code",
        "contextLength": 262144,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "hf:Qwen/Qwen3.6-27B",
        "name": "Qwen/Qwen3.6-27B",
        "contextLength": 262144,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "hf:MiniMaxAI/MiniMax-M3",
        "name": "MiniMaxAI/MiniMax-M3",
        "contextLength": 262144,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "hf:zai-org/GLM-4.7-Flash",
        "name": "zai-org/GLM-4.7-Flash",
        "contextLength": 196608,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
        "name": "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
        "contextLength": 262144,
        "toolCalling": true,
        "supportsReasoning": true
      }
    ]
  },
  "ideogram": {
    "id": "ideogram",
    "alias": "ideo",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.ideogram.ai",
    "authType": "apikey",
    "authHeader": "Api-Key",
    "models": [
      {
        "id": "V_3",
        "name": "Ideogram V3"
      },
      {
        "id": "V_2A",
        "name": "Ideogram V2A"
      }
    ]
  },
  "friendliai": {
    "id": "friendliai",
    "alias": "friendli",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.friendli.ai/serverless/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "meta-llama-3.1-70b-instruct",
        "name": "meta-llama-3.1-70b-instruct"
      },
      {
        "id": "meta-llama-3.1-8b-instruct",
        "name": "meta-llama-3.1-8b-instruct"
      }
    ]
  },
  "sambanova": {
    "id": "sambanova",
    "alias": "samba",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.sambanova.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax-M2.7"
      },
      {
        "id": "DeepSeek-V3.2",
        "name": "DeepSeek-V3.2"
      },
      {
        "id": "Llama-4-Maverick-17B-128E-Instruct",
        "name": "Llama-4-Maverick-17B-128E-Instruct"
      },
      {
        "id": "Meta-Llama-3.3-70B-Instruct",
        "name": "Meta-Llama-3.3-70B-Instruct"
      },
      {
        "id": "gpt-oss-120b",
        "name": "gpt-oss-120b"
      }
    ]
  },
  "upstage": {
    "id": "upstage",
    "alias": "upstage",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.upstage.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "solar-pro3",
        "name": "solar-pro3"
      },
      {
        "id": "solar-mini",
        "name": "solar-mini"
      }
    ]
  },
  "nebius": {
    "id": "nebius",
    "alias": "nebius",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.tokenfactory.nebius.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "Llama 3.3 70B Instruct"
      }
    ]
  },
  "fireworks": {
    "id": "fireworks",
    "alias": "fireworks",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.fireworks.ai/inference/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "supportsReasoning": true
      },
      {
        "id": "glm-5p1",
        "name": "GLM 5.1"
      },
      {
        "id": "gpt-oss-120b",
        "name": "OpenAI gpt-oss-120b"
      },
      {
        "id": "gpt-oss-20b",
        "name": "OpenAI gpt-oss-20b"
      },
      {
        "id": "kimi-k2p5",
        "name": "Kimi K2.5"
      },
      {
        "id": "kimi-k2p6",
        "name": "Kimi K2.6"
      },
      {
        "id": "minimax-m2p5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "minimax-m2p7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "qwen3p6-plus",
        "name": "Qwen3.6 Plus"
      }
    ]
  },
  "llamagate": {
    "id": "llamagate",
    "alias": "llamagate",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://llamagate.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "qwen2.5-coder-7b",
        "name": "qwen2.5-coder-7b"
      },
      {
        "id": "deepseek-coder-6.7b",
        "name": "deepseek-coder-6.7b"
      },
      {
        "id": "qwen3-vl-8b",
        "name": "qwen3-vl-8b"
      }
    ]
  },
  "dify": {
    "id": "dify",
    "alias": "dify",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.dify.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "auto",
        "name": "Auto"
      }
    ]
  },
  "xiaomi-mimo": {
    "id": "xiaomi-mimo",
    "alias": "mimo",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.xiaomimimo.com/v1",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo-V2.5-Pro",
        "contextLength": 1048576
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo-V2.5",
        "contextLength": 1048576
      }
    ]
  },
  "xiaomi-mimo-token-plan": {
    "id": "xiaomi-mimo-token-plan",
    "alias": "mimotp",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://token-plan-sgp.xiaomimimo.com/v1",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo-V2.5-Pro",
        "contextLength": 1048576
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo-V2.5",
        "contextLength": 1048576
      }
    ]
  },
  "codestral": {
    "id": "codestral",
    "alias": "codestral",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://codestral.mistral.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "codestral-2508",
        "name": "codestral-2508"
      },
      {
        "id": "codestral-latest",
        "name": "codestral-latest"
      }
    ]
  },
  "wandb": {
    "id": "wandb",
    "alias": "wandb",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.inference.wandb.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "openai/gpt-oss-120b",
        "name": "openai/gpt-oss-120b"
      },
      {
        "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "name": "Qwen/Qwen3-Coder-480B-A35B-Instruct"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.1",
        "name": "deepseek-ai/DeepSeek-V3.1"
      }
    ]
  },
  "predibase": {
    "id": "predibase",
    "alias": "predibase",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://serving.app.predibase.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "llama-3.3-70b",
        "name": "llama-3.3-70b"
      }
    ]
  },
  "baichuan": {
    "id": "baichuan",
    "alias": "baichuan",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.baichuan-ai.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "Baichuan4-Turbo",
        "name": "Baichuan 4 Turbo",
        "contextLength": 32768
      },
      {
        "id": "Baichuan4-Air",
        "name": "Baichuan 4 Air",
        "contextLength": 32768
      },
      {
        "id": "Baichuan4",
        "name": "Baichuan 4"
      },
      {
        "id": "Baichuan3-Turbo",
        "name": "Baichuan 3 Turbo",
        "contextLength": 32768
      },
      {
        "id": "Baichuan3-Turbo-128k",
        "name": "Baichuan 3 Turbo 128k",
        "contextLength": 131072
      }
    ]
  },
  "yi": {
    "id": "yi",
    "alias": "yi",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.lingyiwanwu.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "yi-large",
        "name": "Yi Large"
      }
    ]
  },
  "deepseek": {
    "id": "deepseek",
    "alias": "ds",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.deepseek.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "supportsReasoning": true
      }
    ]
  },
  "dgrid": {
    "id": "dgrid",
    "alias": "dgrid",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.dgrid.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "passthroughModels": true,
    "models": [
      {
        "id": "dgridai/free",
        "name": "DGrid Free Models Router"
      }
    ]
  },
  "groq": {
    "id": "groq",
    "alias": "groq",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.groq.com/openai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "meta-llama/llama-4-scout-17b-16e-instruct",
        "name": "Llama 4 Scout",
        "supportsReasoning": false
      },
      {
        "id": "llama-3.3-70b-versatile",
        "name": "Llama 3.3 70B",
        "supportsReasoning": false
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "GPT-OSS 120B"
      },
      {
        "id": "openai/gpt-oss-20b",
        "name": "GPT-OSS 20B"
      },
      {
        "id": "qwen/qwen3-32b",
        "name": "Qwen3 32B"
      },
      {
        "id": "qwen/qwen3.6-27b",
        "name": "Qwen3.6 27B"
      },
      {
        "id": "openai/gpt-oss-safeguard-20b",
        "name": "GPT-OSS Safeguard 20B"
      }
    ]
  },
  "inference-net": {
    "id": "inference-net",
    "alias": "inet",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.inference.net/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "meta-llama/Llama-3.3-70B-Instruct"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "deepseek-ai/DeepSeek-R1"
      },
      {
        "id": "Qwen/Qwen2.5-72B-Instruct",
        "name": "Qwen/Qwen2.5-72B-Instruct"
      }
    ]
  },
  "llm7": {
    "id": "llm7",
    "alias": "llm7",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.llm7.io/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "gpt-4o-mini-2024-07-18",
        "name": "GPT-4o mini (LLM7)"
      },
      {
        "id": "gpt-4.1-nano-2025-04-14",
        "name": "GPT-4.1 nano (LLM7)"
      },
      {
        "id": "deepseek-r1-0528",
        "name": "DeepSeek R1 (LLM7)"
      },
      {
        "id": "qwen2.5-coder-32b-instruct",
        "name": "Qwen2.5 Coder 32B (LLM7)"
      }
    ]
  },
  "cerebras": {
    "id": "cerebras",
    "alias": "cerebras",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.cerebras.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "zai-glm-4.7",
        "name": "GLM 4.7"
      },
      {
        "id": "gemma-4-31b",
        "name": "Gemma 4 31B"
      },
      {
        "id": "gpt-oss-120b",
        "name": "GPT OSS 120B"
      }
    ]
  },
  "charm-hyper": {
    "id": "charm-hyper",
    "alias": "charm-hyper",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://hyper.charm.land/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "hyper/auto",
        "name": "Charm Hyper Auto"
      }
    ]
  },
  "sparkdesk": {
    "id": "sparkdesk",
    "alias": "sparkdesk",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://spark-api-open.xf-yun.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "4.0Ultra",
        "name": "Spark 4.0 Ultra",
        "contextLength": 32768
      },
      {
        "id": "generalv3",
        "name": "Spark Pro",
        "contextLength": 8192
      },
      {
        "id": "pro-128k",
        "name": "Spark Pro 128K",
        "contextLength": 131072
      },
      {
        "id": "lite",
        "name": "Spark Lite",
        "contextLength": 4096
      }
    ]
  },
  "nlpcloud": {
    "id": "nlpcloud",
    "alias": "nlpc",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.nlpcloud.io/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "chatdolphin",
        "name": "ChatDolphin",
        "contextLength": 8192
      },
      {
        "id": "dolphin",
        "name": "Dolphin",
        "contextLength": 16384
      },
      {
        "id": "finetuned-llama-3-70b",
        "name": "Fine-tuned LLaMA 3.3 70B"
      },
      {
        "id": "llama-3-1-405b",
        "name": "LLaMA 3.1 405B"
      },
      {
        "id": "llama-3-8b-instruct",
        "name": "Llama 3 8B"
      }
    ]
  },
  "nvidia": {
    "id": "nvidia",
    "alias": "nvidia",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://integrate.api.nvidia.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "z-ai/glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "minimaxai/minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "google/gemma-4-31b-it",
        "name": "Gemma 4 31B"
      },
      {
        "id": "mistralai/mistral-small-4-119b-2603",
        "name": "Mistral Small 4 2603"
      },
      {
        "id": "mistralai/mistral-large-3-675b-instruct-2512",
        "name": "Mistral Large 3 675B"
      },
      {
        "id": "mistralai/devstral-2-123b-instruct-2512",
        "name": "Devstral 2 123B"
      },
      {
        "id": "qwen/qwen3.5-397b-a17b",
        "name": "Qwen3.5-397B-A17B"
      },
      {
        "id": "qwen/qwen3.5-122b-a10b",
        "name": "Qwen3.5-122B-A10B"
      },
      {
        "id": "stepfun-ai/step-3.5-flash",
        "name": "Step 3.5 Flash"
      },
      {
        "id": "stepfun-ai/step-3.7-flash",
        "name": "Step 3.7 Flash"
      },
      {
        "id": "moonshotai/kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B",
        "toolCalling": false
      },
      {
        "id": "openai/gpt-oss-20b",
        "name": "GPT OSS 20B",
        "toolCalling": false
      },
      {
        "id": "nvidia/nemotron-3-super-120b-a12b",
        "name": "Nemotron 3 Super 120B A12B"
      },
      {
        "id": "nvidia/nemotron-3-ultra-550b-a55b",
        "name": "Nemotron 3 Ultra 550B"
      },
      {
        "id": "abacusai/dracarys-llama-3.1-70b-instruct",
        "name": "Dracarys Llama 3.1 70B Instruct"
      },
      {
        "id": "google/gemma-2-2b-it",
        "name": "Gemma 2 2B IT"
      },
      {
        "id": "google/gemma-3n-e2b-it",
        "name": "Gemma 3n E2B IT"
      },
      {
        "id": "meta/llama-3.1-8b-instruct",
        "name": "Llama 3.1 8B Instruct",
        "toolCalling": false
      },
      {
        "id": "meta/llama-3.2-11b-vision-instruct",
        "name": "Llama 3.2 11B Vision Instruct",
        "supportsVision": true
      },
      {
        "id": "meta/llama-3.2-1b-instruct",
        "name": "Llama 3.2 1B Instruct"
      },
      {
        "id": "meta/llama-3.2-3b-instruct",
        "name": "Llama 3.2 3B Instruct",
        "toolCalling": false
      },
      {
        "id": "meta/llama-3.2-90b-vision-instruct",
        "name": "Llama 3.2 90B Vision Instruct",
        "supportsVision": true
      },
      {
        "id": "meta/llama-4-maverick-17b-128e-instruct",
        "name": "Llama 4 Maverick 17B 128E Instruct"
      },
      {
        "id": "meta/llama-guard-4-12b",
        "name": "Llama Guard 4 12B",
        "toolCalling": false
      },
      {
        "id": "mistralai/ministral-14b-instruct-2512",
        "name": "Ministral 14B Instruct 2512"
      },
      {
        "id": "mistralai/mistral-medium-3.5-128b",
        "name": "Mistral Medium 3.5 128B"
      },
      {
        "id": "mistralai/mistral-nemotron",
        "name": "Mistral Nemotron"
      },
      {
        "id": "mistralai/mixtral-8x7b-instruct-v0.1",
        "name": "Mixtral 8x7B Instruct v0.1"
      },
      {
        "id": "nvidia/ising-calibration-1-35b-a3b",
        "name": "Ising Calibration 1 35B A3B",
        "supportsReasoning": true
      },
      {
        "id": "nvidia/llama-3.1-nemoguard-8b-content-safety",
        "name": "Llama 3.1 Nemoguard 8B Content Safety"
      },
      {
        "id": "nvidia/llama-3.1-nemoguard-8b-topic-control",
        "name": "Llama 3.1 Nemoguard 8B Topic Control"
      },
      {
        "id": "nvidia/llama-3.1-nemotron-nano-8b-v1",
        "name": "Llama 3.1 Nemotron Nano 8B v1"
      },
      {
        "id": "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
        "name": "Llama 3.1 Nemotron Nano VL 8B v1",
        "supportsVision": true
      },
      {
        "id": "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
        "name": "Llama 3.1 Nemotron Safety Guard 8B v3"
      },
      {
        "id": "nvidia/llama-3.3-nemotron-super-49b-v1",
        "name": "Llama 3.3 Nemotron Super 49B v1"
      },
      {
        "id": "nvidia/llama-3.3-nemotron-super-49b-v1.5",
        "name": "Llama 3.3 Nemotron Super 49B v1.5"
      },
      {
        "id": "nvidia/nemotron-3-content-safety",
        "name": "Nemotron 3 Content Safety"
      },
      {
        "id": "nvidia/nemotron-3-nano-30b-a3b",
        "name": "Nemotron 3 Nano 30B A3B",
        "supportsReasoning": true
      },
      {
        "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "name": "Nemotron 3 Nano Omni 30B A3B Reasoning",
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "nvidia/nemotron-3.5-content-safety",
        "name": "Nemotron 3.5 Content Safety"
      },
      {
        "id": "nvidia/nemotron-mini-4b-instruct",
        "name": "Nemotron Mini 4B Instruct"
      },
      {
        "id": "nvidia/nemotron-nano-12b-v2-vl",
        "name": "Nemotron Nano 12B v2 VL",
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "nvidia/nvidia-nemotron-nano-9b-v2",
        "name": "NVIDIA Nemotron Nano 9B v2",
        "supportsReasoning": true
      },
      {
        "id": "nvidia/riva-translate-4b-instruct-v1.1",
        "name": "Riva Translate 4B Instruct v1.1"
      },
      {
        "id": "qwen/qwen3-next-80b-a3b-instruct",
        "name": "Qwen3 Next 80B A3B Instruct",
        "supportsReasoning": true
      },
      {
        "id": "sarvamai/sarvam-m",
        "name": "Sarvam M"
      },
      {
        "id": "stockmark/stockmark-2-100b-instruct",
        "name": "Stockmark 2 100B Instruct"
      },
      {
        "id": "upstage/solar-10.7b-instruct",
        "name": "Solar 10.7B Instruct"
      }
    ]
  },
  "api-airforce": {
    "id": "api-airforce",
    "alias": "af",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.airforce/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "x-ai/grok-3",
        "name": "Grok-3 (Free)",
        "contextLength": 131072
      },
      {
        "id": "x-ai/grok-2-1212",
        "name": "Grok-2 1212 (Free)",
        "contextLength": 131072
      },
      {
        "id": "anthropic/claude-3.7-sonnet",
        "name": "Claude 3.7 Sonnet (Free)",
        "contextLength": 200000
      },
      {
        "id": "qwen/qwen3-32b",
        "name": "Qwen3 32B (Free)",
        "contextLength": 128000
      },
      {
        "id": "moonshot/kimi-k2.6",
        "name": "Kimi K2.6 (Free)",
        "contextLength": 262144
      },
      {
        "id": "google/gemini-2.5-flash",
        "name": "Gemini 2.5 Flash (Free)",
        "contextLength": 1048576
      },
      {
        "id": "deepseek/deepseek-v3",
        "name": "DeepSeek V3 (Free)",
        "contextLength": 262144
      }
    ]
  },
  "mistral": {
    "id": "mistral",
    "alias": "mistral",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.mistral.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "mistral-large-latest",
        "name": "Mistral Large 3"
      },
      {
        "id": "mistral-medium-3-5",
        "name": "Mistral Medium 3.5"
      },
      {
        "id": "mistral-small-latest",
        "name": "Mistral Small 4"
      },
      {
        "id": "devstral-latest",
        "name": "Devstral 2"
      },
      {
        "id": "codestral-latest",
        "name": "Codestral"
      }
    ]
  },
  "together": {
    "id": "together",
    "alias": "together",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.together.xyz/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
        "name": "Llama 3.3 70B Turbo (🆓 Free)"
      },
      {
        "id": "meta-llama/Llama-Vision-Free",
        "name": "Llama Vision (🆓 Free)"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-Free",
        "name": "DeepSeek R1 Distill 70B (🆓 Free)"
      },
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "name": "Llama 3.3 70B Turbo"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "DeepSeek R1"
      },
      {
        "id": "Qwen/Qwen3-235B-A22B",
        "name": "Qwen3 235B"
      },
      {
        "id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        "name": "Llama 4 Maverick"
      }
    ]
  },
  "cohere": {
    "id": "cohere",
    "alias": "cohere",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.cohere.com/compatibility/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "command-a-reasoning-08-2025",
        "name": "Command A Reasoning (Aug 2025)"
      },
      {
        "id": "command-a-vision-07-2025",
        "name": "Command A Vision (Jul 2025)"
      },
      {
        "id": "command-a-03-2025",
        "name": "Command A (Mar 2025)"
      },
      {
        "id": "command-r7b-12-2024",
        "name": "Command R7B (Dec 2024)"
      },
      {
        "id": "command-r-plus-08-2024",
        "name": "Command R Plus (Aug 2024)"
      },
      {
        "id": "command-r-08-2024",
        "name": "Command R (Aug 2024)"
      }
    ]
  },
  "volcengine": {
    "id": "volcengine",
    "alias": "volcengine",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "deepseek-v3-2-251201",
        "name": "deepseek-v3-2-251201"
      },
      {
        "id": "doubao-seed-2-0-pro-260215",
        "name": "doubao-seed-2-0-pro-260215"
      },
      {
        "id": "doubao-seed-2-0-code-preview-260215",
        "name": "doubao-seed-2-0-code-preview-260215"
      },
      {
        "id": "kimi-k2-5-260127",
        "name": "kimi-k2-5-260127"
      },
      {
        "id": "glm-4-7-251222",
        "name": "glm-4-7-251222"
      },
      {
        "id": "DeepSeek-V4-Flash",
        "name": "DeepSeek-V4-Flash"
      },
      {
        "id": "DeepSeek-V4-Pro",
        "name": "DeepSeek-V4-Pro"
      }
    ]
  },
  "freetheai": {
    "id": "freetheai",
    "alias": "fta",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.freetheai.xyz/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "passthroughModels": true,
    "models": [
      {
        "id": "gpt-4o-mini",
        "name": "GPT-4o Mini"
      },
      {
        "id": "llama-3.3-70b-instruct",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "deepseek-chat",
        "name": "DeepSeek Chat"
      }
    ]
  },
  "tencent": {
    "id": "tencent",
    "alias": "tencent",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "hunyuan-turbos-latest",
        "name": "Hunyuan TurboS Latest",
        "contextLength": 200000
      },
      {
        "id": "hunyuan-t1-latest",
        "name": "Hunyuan T1 Latest",
        "contextLength": 256000
      },
      {
        "id": "hunyuan-pro",
        "name": "Hunyuan Pro"
      },
      {
        "id": "hunyuan-vision",
        "name": "Hunyuan Vision"
      },
      {
        "id": "hunyuan-functioncall",
        "name": "Hunyuan FunctionCall"
      },
      {
        "id": "hunyuan-lite",
        "name": "Hunyuan Lite"
      }
    ]
  },
  "coze": {
    "id": "coze",
    "alias": "coze",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.coze.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "claude-3-7-sonnet-20250514",
        "name": "Claude 3.7 Sonnet"
      }
    ]
  },
  "ai21": {
    "id": "ai21",
    "alias": "ai21",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.ai21.com/studio/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "jamba-large-1.7",
        "name": "jamba-large-1.7"
      },
      {
        "id": "jamba-mini-2",
        "name": "jamba-mini-2"
      }
    ]
  },
  "publicai": {
    "id": "publicai",
    "alias": "publicai",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.publicai.co/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "swiss-ai/apertus-70b-instruct",
        "name": "swiss-ai/apertus-70b-instruct"
      },
      {
        "id": "swiss-ai/Apertus-8B-Instruct-2509",
        "name": "swiss-ai/Apertus-8B-Instruct-2509"
      },
      {
        "id": "aisingapore/Qwen-SEA-LION-v4-32B-IT",
        "name": "aisingapore/Qwen-SEA-LION-v4-32B-IT"
      },
      {
        "id": "aisingapore/Gemma-SEA-LION-v4-27B-IT",
        "name": "aisingapore/Gemma-SEA-LION-v4-27B-IT"
      },
      {
        "id": "allenai/Olmo-3-32B-Think",
        "name": "allenai/Olmo-3-32B-Think"
      },
      {
        "id": "allenai/Olmo-3-7B-Instruct",
        "name": "allenai/Olmo-3-7B-Instruct"
      },
      {
        "id": "utter-project/EuroLLM-22B-Instruct-2512",
        "name": "utter-project/EuroLLM-22B-Instruct-2512"
      }
    ]
  },
  "featherless-ai": {
    "id": "featherless-ai",
    "alias": "featherless",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.featherless.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "featherless-ai/Qwerky-72B",
        "name": "featherless-ai/Qwerky-72B"
      },
      {
        "id": "featherless-ai/Qwerky-QwQ-32B",
        "name": "featherless-ai/Qwerky-QwQ-32B"
      }
    ]
  },
  "openai": {
    "id": "openai",
    "alias": "openai",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "gpt-5.6",
        "name": "GPT-5.6",
        "contextLength": 1050000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "gpt-5.6-sol",
        "name": "GPT-5.6 Sol",
        "contextLength": 1050000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "gpt-5.6-terra",
        "name": "GPT-5.6 Terra",
        "contextLength": 1050000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "gpt-5.6-luna",
        "name": "GPT-5.6 Luna",
        "contextLength": 1050000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5",
        "contextLength": 1050000
      },
      {
        "id": "gpt-5.5-pro",
        "name": "GPT-5.5 Pro",
        "contextLength": 1050000
      },
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4",
        "contextLength": 1050000
      },
      {
        "id": "gpt-5.4-pro",
        "name": "GPT-5.4 Pro",
        "contextLength": 1050000
      },
      {
        "id": "gpt-5.4-mini",
        "name": "GPT-5.4 Mini",
        "contextLength": 400000
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT-5.4 Nano",
        "contextLength": 400000
      },
      {
        "id": "gpt-4.1",
        "name": "GPT-4.1",
        "contextLength": 1047576
      },
      {
        "id": "gpt-4.1-mini",
        "name": "GPT-4.1 Mini",
        "contextLength": 1047576
      },
      {
        "id": "gpt-4.1-nano",
        "name": "GPT-4.1 Nano",
        "contextLength": 1047576
      },
      {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "contextLength": 128000
      },
      {
        "id": "gpt-4o-2024-11-20",
        "name": "GPT-4o (Nov 2024)",
        "contextLength": 128000
      },
      {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "contextLength": 128000
      },
      {
        "id": "gpt-4o-mini",
        "name": "GPT-4o Mini",
        "contextLength": 128000
      },
      {
        "id": "o3",
        "name": "O3",
        "contextLength": 200000
      },
      {
        "id": "o3-mini",
        "name": "O3 Mini",
        "contextLength": 200000
      },
      {
        "id": "o4-mini",
        "name": "O4 Mini",
        "contextLength": 200000
      }
    ]
  },
  "snowflake": {
    "id": "snowflake",
    "alias": "snowflake",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://{account}.snowflakecomputing.com/api/v2",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "llama3.1-70b",
        "name": "llama3.1-70b"
      },
      {
        "id": "llama3.3-70b",
        "name": "llama3.3-70b"
      },
      {
        "id": "deepseek-r1",
        "name": "deepseek-r1"
      },
      {
        "id": "claude-3-5-sonnet",
        "name": "claude-3-5-sonnet"
      }
    ]
  },
  "huggingface": {
    "id": "huggingface",
    "alias": "hf",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://router.huggingface.co/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "meta-llama/llama-3.1-8b-instruct",
        "name": "Llama 3.1 8B"
      },
      {
        "id": "meta-llama/llama-3.2-11b-instruct",
        "name": "Llama 3.2 11B"
      },
      {
        "id": "mistralai/mistral-7b-instruct",
        "name": "Mistral 7B"
      },
      {
        "id": "google/gemma-2-9b-it",
        "name": "Gemma 2 9B"
      },
      {
        "id": "Qwen/Qwen2.5-7B-Instruct",
        "name": "Qwen 2.5 7B"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3",
        "name": "DeepSeek V3"
      }
    ]
  },
  "freeaiapikey": {
    "id": "freeaiapikey",
    "alias": "faik",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://freeaiapikey.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "openai/gpt-5",
        "name": "GPT-5 (via FreeAIAPIKey)",
        "contextLength": 400000
      },
      {
        "id": "openai/gpt-4o",
        "name": "GPT-4o (via FreeAIAPIKey)"
      },
      {
        "id": "openai/gpt-5.2-codex",
        "name": "GPT-5.2 Codex (via FreeAIAPIKey)"
      },
      {
        "id": "anthropic/claude-opus-4.6",
        "name": "Claude Opus 4.6 (via FreeAIAPIKey)",
        "contextLength": 1000000
      },
      {
        "id": "anthropic/claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6 (via FreeAIAPIKey)",
        "contextLength": 1000000
      },
      {
        "id": "Alibaba/qwen3.5",
        "name": "Qwen 3.5 (via FreeAIAPIKey)",
        "contextLength": 128000
      },
      {
        "id": "Alibaba/qwen3-vl:235b",
        "name": "Qwen 3 VL 235B (via FreeAIAPIKey)",
        "contextLength": 128000
      }
    ]
  },
  "qwen-cloud": {
    "id": "qwen-cloud",
    "alias": "qwc",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "qwen3.7-max-2026-06-08",
        "name": "Qwen3.7 Max (2026-06-08)"
      },
      {
        "id": "qwen3.7-plus",
        "name": "Qwen3.7 Plus"
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen3.6 Plus"
      },
      {
        "id": "qwen3.6-27b",
        "name": "Qwen3.6 27B"
      },
      {
        "id": "qwen3.6-35b-a3b",
        "name": "Qwen3.6 35B A3B"
      },
      {
        "id": "qwen3.5-plus-2026-04-20",
        "name": "Qwen3.5 Plus (2026-04-20)"
      },
      {
        "id": "qwen3.5-122b-a10b",
        "name": "Qwen3.5 122B A10B"
      },
      {
        "id": "qwen3.5-397b-a17b",
        "name": "Qwen3.5 397B A17B"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.2-fast-preview",
        "name": "GLM 5.2 Fast Preview"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      }
    ]
  },
  "qwen-cloud-token-plan": {
    "id": "qwen-cloud-token-plan",
    "alias": "qct",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "qwen3.8-max-preview",
        "name": "Qwen3.8 Max Preview",
        "contextLength": 1000000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "qwen3.7-max",
        "name": "Qwen3.7 Max",
        "contextLength": 1000000,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "qwen3.7-plus",
        "name": "Qwen3.7 Plus",
        "contextLength": 1000000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "qwen3.6-flash",
        "name": "Qwen3.6 Flash",
        "contextLength": 1000000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2",
        "contextLength": 1000000,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "contextLength": 163840,
        "toolCalling": true,
        "supportsReasoning": true
      }
    ]
  },
  "modal": {
    "id": "modal",
    "alias": "modal",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.modal.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "google/gemini-2.0-flash",
        "name": "Gemini 2.0 Flash"
      }
    ]
  },
  "zenmux": {
    "id": "zenmux",
    "alias": "zm",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://zenmux.ai/api/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "google/gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro Preview (ZenMux)",
        "contextLength": 1048576,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "google/gemini-3-flash-preview",
        "name": "Gemini 3 Flash Preview (ZenMux)",
        "contextLength": 1048576,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "openai/gpt-5",
        "name": "GPT-5 (ZenMux)",
        "contextLength": 400000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "anthropic/claude-sonnet-4.5",
        "name": "Claude Sonnet 4.5 (ZenMux)",
        "contextLength": 200000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "anthropic/claude-opus-4.5",
        "name": "Claude Opus 4.5 (ZenMux)",
        "contextLength": 200000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "deepseek/deepseek-chat",
        "name": "DeepSeek V3.2 Chat (ZenMux)",
        "contextLength": 128000,
        "toolCalling": true,
        "supportsVision": false,
        "supportsReasoning": false
      },
      {
        "id": "x-ai/grok-4.1-fast",
        "name": "Grok 4.1 Fast (ZenMux)",
        "contextLength": 131072,
        "toolCalling": true,
        "supportsVision": false,
        "supportsReasoning": true
      },
      {
        "id": "mistralai/mistral-large-2512",
        "name": "Mistral Large 2512 (ZenMux)",
        "contextLength": 128000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": false
      },
      {
        "id": "z-ai/glm-4.6v-flash",
        "name": "GLM 4.6V Flash (ZenMux)",
        "contextLength": 128000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": false
      }
    ]
  },
  "leonardo": {
    "id": "leonardo",
    "alias": "leo",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://cloud.leonardo.ai/api/rest/v1",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "phoenix",
        "name": "Phoenix"
      },
      {
        "id": "sdxl",
        "name": "SDXL"
      }
    ]
  },
  "kie": {
    "id": "kie",
    "alias": "kie",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.kie.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "claude-opus-4-8",
        "name": "Claude 4.8 Opus"
      },
      {
        "id": "claude-opus-4-7",
        "name": "Claude 4.7 Opus"
      },
      {
        "id": "claude-sonnet-4-6",
        "name": "Claude 4.6 Sonnet"
      },
      {
        "id": "claude-haiku-4-5",
        "name": "Claude 4.5 Haiku"
      },
      {
        "id": "gpt-5-5",
        "name": "GPT 5.5"
      },
      {
        "id": "gpt-5-4",
        "name": "GPT 5.4"
      },
      {
        "id": "gpt-5-2",
        "name": "GPT 5.2"
      },
      {
        "id": "gemini-3-1-pro",
        "name": "Gemini 3.1 Pro"
      },
      {
        "id": "gemini-2-5-pro",
        "name": "Gemini 2.5 Pro"
      },
      {
        "id": "gemini-3-flash",
        "name": "Gemini 3 Flash"
      },
      {
        "id": "gemini-3-5-flash",
        "name": "Gemini 3.5 Flash"
      }
    ]
  },
  "monsterapi": {
    "id": "monsterapi",
    "alias": "monster",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.monsterapi.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "meta-llama/Meta-Llama-3.1-8B-Instruct",
        "name": "Llama 3.1 8B Instruct"
      },
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "Llama 3.3 70B Instruct"
      }
    ]
  },
  "sensenova": {
    "id": "sensenova",
    "alias": "sensenova",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://token.sensenova.cn/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "sensenova-6.7-flash-lite",
        "name": "SenseNova 6.7 Flash-Lite",
        "contextLength": 262144,
        "toolCalling": true,
        "supportsVision": true
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "contextLength": 1048576,
        "supportsReasoning": true
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2",
        "contextLength": 1048576,
        "supportsReasoning": true
      }
    ]
  },
  "hyperbolic": {
    "id": "hyperbolic",
    "alias": "hyp",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.hyperbolic.xyz/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "Qwen/QwQ-32B",
        "name": "QwQ 32B"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "DeepSeek R1"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3",
        "name": "DeepSeek V3"
      },
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "meta-llama/Llama-3.2-3B-Instruct",
        "name": "Llama 3.2 3B"
      },
      {
        "id": "Qwen/Qwen2.5-72B-Instruct",
        "name": "Qwen 2.5 72B"
      },
      {
        "id": "Qwen/Qwen2.5-Coder-32B-Instruct",
        "name": "Qwen 2.5 Coder 32B"
      },
      {
        "id": "NousResearch/Hermes-3-Llama-3.1-70B",
        "name": "Hermes 3 70B"
      }
    ]
  },
  "lambda-ai": {
    "id": "lambda-ai",
    "alias": "lambda",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.lambda.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "deepseek-r1-671b",
        "name": "deepseek-r1-671b"
      },
      {
        "id": "llama3.3-70b-instruct-fp8",
        "name": "llama3.3-70b-instruct-fp8"
      },
      {
        "id": "qwen25-coder-32b-instruct",
        "name": "qwen25-coder-32b-instruct"
      }
    ]
  },
  "iflytek": {
    "id": "iflytek",
    "alias": "iflytek",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://spark-api-open.xf-yun.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "4.0Ultra",
        "name": "Spark 4.0 Ultra",
        "contextLength": 32768
      },
      {
        "id": "generalv3.5",
        "name": "Spark Max (V3.5)"
      },
      {
        "id": "max-32k",
        "name": "Spark Max 32K",
        "contextLength": 32768
      },
      {
        "id": "generalv3",
        "name": "Spark Pro",
        "contextLength": 8192
      },
      {
        "id": "pro-128k",
        "name": "Spark Pro 128K",
        "contextLength": 131072
      },
      {
        "id": "lite",
        "name": "Spark Lite",
        "contextLength": 4096
      }
    ]
  },
  "crof": {
    "id": "crof",
    "alias": "crof",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://crof.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "deepseek-v4-pro-precision",
        "name": "DeepSeek V4 Pro (Precision)",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-pro-lightning",
        "name": "DeepSeek V4 Pro (Lightning)",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-flash-0731",
        "name": "DeepSeek V4 Flash 0731",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v3.2",
        "name": "DeepSeek V3.2"
      },
      {
        "id": "kimi-k2.6-precision",
        "name": "Kimi K2.6 (Precision)",
        "supportsReasoning": true
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6",
        "supportsReasoning": true
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code",
        "supportsReasoning": true
      },
      {
        "id": "kimi-k3",
        "name": "Kimi K3",
        "supportsReasoning": true
      },
      {
        "id": "kimi-k3-eco",
        "name": "Kimi K3 Eco",
        "supportsReasoning": true
      },
      {
        "id": "kimi-k2.5-lightning",
        "name": "Kimi K2.5 (Lightning)",
        "supportsReasoning": true
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5",
        "supportsReasoning": true
      },
      {
        "id": "glm-5.1-precision",
        "name": "GLM 5.1 (Precision)",
        "supportsReasoning": true
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1",
        "supportsReasoning": true
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2",
        "supportsReasoning": true
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7",
        "supportsReasoning": true
      },
      {
        "id": "glm-4.7-flash",
        "name": "GLM 4.7 Flash",
        "supportsReasoning": true
      },
      {
        "id": "mimo-v2.5-pro-precision",
        "name": "Mimo 2.5 Pro (Precision)",
        "supportsReasoning": true
      },
      {
        "id": "mimo-v2.5-pro",
        "name": "Mimo 2.5 Pro",
        "supportsReasoning": true
      },
      {
        "id": "gemma-4-31b-it",
        "name": "Gemma 4 31B",
        "supportsReasoning": true
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "qwen3.6-27b",
        "name": "Qwen3.6 27B",
        "supportsReasoning": true
      },
      {
        "id": "qwen3.5-397b-a17b",
        "name": "Qwen3.5 397B A17B",
        "supportsReasoning": true
      },
      {
        "id": "qwen3.5-9b",
        "name": "Qwen3.5 9B",
        "supportsReasoning": true
      }
    ]
  },
  "poe": {
    "id": "poe",
    "alias": "poe",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.poe.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "gpt-5.2",
        "name": "GPT-5.2"
      },
      {
        "id": "claude-opus-4.8",
        "name": "Claude Opus 4.8"
      },
      {
        "id": "gemini-3.0-pro",
        "name": "Gemini 3.0 Pro"
      }
    ]
  },
  "bazaarlink": {
    "id": "bazaarlink",
    "alias": "bzl",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://bazaarlink.ai/api/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "auto:free",
        "name": "Auto Free (Zero Cost)"
      },
      {
        "id": "claude-opus-4.7",
        "name": "Claude Opus 4.7"
      },
      {
        "id": "claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "claude-haiku-4.5",
        "name": "Claude Haiku 4.5"
      },
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5"
      },
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4"
      },
      {
        "id": "gpt-5.4-mini",
        "name": "GPT-5.4 Mini"
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT-5.4 Nano"
      },
      {
        "id": "grok-4.3",
        "name": "Grok 4.3"
      },
      {
        "id": "grok-4.20",
        "name": "Grok 4.20"
      },
      {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro"
      },
      {
        "id": "gemini-3-flash-preview",
        "name": "Gemini 3 Flash"
      },
      {
        "id": "gemini-3.1-flash-lite-preview",
        "name": "Gemini 3.1 Flash Lite"
      },
      {
        "id": "gemma-4-31b-it",
        "name": "Gemma 4 31B"
      },
      {
        "id": "gemma-4-26b-a4b-it",
        "name": "Gemma 4 26B A4B"
      },
      {
        "id": "deepseek-v3.2",
        "name": "DeepSeek V3.2"
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "kimi-k2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "glm-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "glm-5",
        "name": "GLM 5"
      },
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo-V2.5-Pro"
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo-V2.5"
      },
      {
        "id": "minimax-m3",
        "name": "MiniMax M3",
        "contextLength": 1048576,
        "supportsVision": true
      },
      {
        "id": "minimax-m2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "llama-4-maverick",
        "name": "Llama 4 Maverick"
      },
      {
        "id": "llama-4-scout",
        "name": "Llama 4 Scout"
      },
      {
        "id": "llama-3.3-70b-instruct",
        "name": "Llama 3.3 70B"
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen 3.6 Plus"
      },
      {
        "id": "mistral-large-2512",
        "name": "Mistral Large 3"
      },
      {
        "id": "mistral-medium-3.1",
        "name": "Mistral Medium 3.1"
      },
      {
        "id": "mistral-small-2603",
        "name": "Mistral Small 4"
      },
      {
        "id": "nemotron-3-super-120b-a12b",
        "name": "Nemotron 3 Super"
      }
    ]
  },
  "perplexity": {
    "id": "perplexity",
    "alias": "pplx",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.perplexity.ai/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "sonar-deep-research",
        "name": "Sonar Deep Research"
      },
      {
        "id": "sonar-reasoning-pro",
        "name": "Sonar Reasoning Pro"
      },
      {
        "id": "sonar-pro",
        "name": "Sonar Pro"
      },
      {
        "id": "sonar",
        "name": "Sonar"
      }
    ]
  },
  "minimax": {
    "id": "minimax",
    "alias": "minimax",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.minimax.io/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "MiniMax-M3",
        "name": "MiniMax M3",
        "contextLength": 1048576,
        "supportsVision": true
      },
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "MiniMax-M2.7-highspeed",
        "name": "MiniMax M2.7 Highspeed"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "MiniMax-M2.5-highspeed",
        "name": "MiniMax M2.5 Highspeed"
      }
    ]
  },
  "minimax-cn": {
    "id": "minimax-cn",
    "alias": "minimax-cn",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.minimaxi.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "MiniMax-M3",
        "name": "MiniMax M3",
        "contextLength": 1048576,
        "supportsVision": true
      },
      {
        "id": "MiniMax-M2.7",
        "name": "MiniMax M2.7"
      },
      {
        "id": "MiniMax-M2.7-highspeed",
        "name": "MiniMax M2.7 Highspeed"
      },
      {
        "id": "MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "MiniMax-M2.5-highspeed",
        "name": "MiniMax M2.5 Highspeed"
      }
    ]
  },
  "haiper": {
    "id": "haiper",
    "alias": "hp",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.haiper.ai/v1",
    "authType": "apikey",
    "authHeader": "HAIPER_KEY",
    "models": [
      {
        "id": "gen2",
        "name": "Gen 2 Video"
      },
      {
        "id": "gen2-image",
        "name": "Gen 2 Image"
      }
    ]
  },
  "bytez": {
    "id": "bytez",
    "alias": "bytez",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.bytez.com/models/v2/openai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "meta-llama/Llama-3.3-70B-Instruct"
      },
      {
        "id": "mistralai/Mistral-7B-Instruct-v0.3",
        "name": "mistralai/Mistral-7B-Instruct-v0.3"
      },
      {
        "id": "Qwen/Qwen2.5-72B-Instruct",
        "name": "Qwen/Qwen2.5-72B-Instruct"
      }
    ]
  },
  "blackbox": {
    "id": "blackbox",
    "alias": "bb",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.blackbox.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "claude-fable-5",
        "name": "Claude Fable 5"
      },
      {
        "id": "claude-opus-4.8",
        "name": "Claude Opus 4.8"
      },
      {
        "id": "claude-sonnet-5",
        "name": "Claude Sonnet 5"
      },
      {
        "id": "claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6"
      },
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5"
      },
      {
        "id": "gpt-5.4-pro",
        "name": "GPT-5.4 Pro"
      },
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4"
      },
      {
        "id": "gpt-5.3-codex",
        "name": "GPT-5.3 Codex"
      },
      {
        "id": "gpt-5.4-nano",
        "name": "GPT-5.4 Nano"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "grok-4.3",
        "name": "Grok 4.3"
      }
    ]
  },
  "nscale": {
    "id": "nscale",
    "alias": "nscale",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://inference.api.nscale.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "moonshotai/Kimi-K2.5",
        "name": "moonshotai/Kimi-K2.5"
      },
      {
        "id": "Qwen/Qwen3-235B-A22B-Instruct-2507",
        "name": "Qwen/Qwen3-235B-A22B-Instruct-2507"
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "openai/gpt-oss-120b"
      },
      {
        "id": "openai/gpt-oss-20b",
        "name": "openai/gpt-oss-20b"
      },
      {
        "id": "meta-llama/Llama-4-Scout-17B-16E-Instruct",
        "name": "meta-llama/Llama-4-Scout-17B-16E-Instruct"
      },
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "name": "meta-llama/Llama-3.3-70B-Instruct"
      }
    ]
  },
  "openrouter": {
    "id": "openrouter",
    "alias": "openrouter",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://openrouter.ai/api/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "passthroughModels": true,
    "models": [
      {
        "id": "auto",
        "name": "Auto (Best Available)"
      }
    ]
  },
  "openvecta": {
    "id": "openvecta",
    "alias": "openvecta",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.openvecta.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "glm-4.7-flash",
        "name": "GLM 4.7 Flash",
        "contextLength": 131072
      },
      {
        "id": "claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6",
        "contextLength": 1000000
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "contextLength": 131072
      },
      {
        "id": "gpt-oss-120b",
        "name": "GPT OSS 120B",
        "contextLength": 131072
      },
      {
        "id": "gemma-4-31b",
        "name": "Gemma 4 31B",
        "contextLength": 262144
      },
      {
        "id": "kimi-k2.6",
        "name": "Kimi K2.6",
        "contextLength": 200000
      },
      {
        "id": "llama-3.3-70b-instruct",
        "name": "Llama 3.3 70B Instruct",
        "contextLength": 131072
      },
      {
        "id": "llama-4-maverick",
        "name": "Llama 4 Maverick",
        "contextLength": 1048576
      },
      {
        "id": "nemotron-3-super-120b",
        "name": "Nemotron 3 Super 120B",
        "contextLength": 262144
      }
    ]
  },
  "openference-api": {
    "id": "openference-api",
    "alias": "ofa",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.openference.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "GLM-5.2",
        "name": "GLM 5.2",
        "contextLength": 850000
      }
    ]
  },
  "orcarouter": {
    "id": "orcarouter",
    "alias": "orcarouter",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.orcarouter.ai/v1",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "orcarouter/auto",
        "name": "Auto (smart routing)",
        "toolCalling": true
      },
      {
        "id": "openai/gpt-5.5",
        "name": "GPT-5.5",
        "contextLength": 1050000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "google/gemini-3.5-flash",
        "name": "Gemini 3.5 Flash",
        "contextLength": 1048576,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "anthropic/claude-opus-4.8",
        "name": "Claude Opus 4.8",
        "contextLength": 1000000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "grok/grok-4.3",
        "name": "Grok 4.3",
        "contextLength": 1000000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "deepseek/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "contextLength": 1048576,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "minimax/minimax-m2.7",
        "name": "MiniMax M2.7",
        "contextLength": 204800,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "qwen/qwen3.7-max",
        "name": "Qwen3.7 Max",
        "contextLength": 1000000,
        "toolCalling": true
      }
    ]
  },
  "stepfun": {
    "id": "stepfun",
    "alias": "stepfun",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.stepfun.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "step-3.7-flash",
        "name": "Step 3.7 Flash",
        "contextLength": 262144
      },
      {
        "id": "step-3.5-flash",
        "name": "Step 3.5 Flash",
        "contextLength": 262144
      },
      {
        "id": "step-3.5-flash-2603",
        "name": "Step 3.5 Flash 2603",
        "contextLength": 262144
      },
      {
        "id": "step-1o-turbo-vision",
        "name": "Step 1o Turbo Vision",
        "contextLength": 32768
      },
      {
        "id": "step-1v",
        "name": "Step 1V"
      }
    ]
  },
  "freemodel-dev": {
    "id": "freemodel-dev",
    "alias": "fmd",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.freemodel.dev/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "gpt-5.5",
        "name": "GPT-5.5",
        "contextLength": 400000
      },
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4",
        "contextLength": 400000
      },
      {
        "id": "gpt-5.4-mini",
        "name": "GPT-5.4 Mini"
      },
      {
        "id": "gpt-5.3-codex",
        "name": "GPT-5.3 Codex"
      }
    ]
  },
  "gitlawb-gmi": {
    "id": "gitlawb-gmi",
    "alias": "glb-gmi",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://opengateway.gitlawb.com/v1/gmi-cloud",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "XiaomiMiMo/MiMo-V2.5-Pro",
        "name": "MiMo-V2.5-Pro (GMI)",
        "contextLength": 1050000
      },
      {
        "id": "XiaomiMiMo/MiMo-V2.5",
        "name": "MiMo-V2.5 (GMI)",
        "contextLength": 1050000
      },
      {
        "id": "openai/gpt-5.5",
        "name": "GPT-5.5",
        "contextLength": 1050000
      },
      {
        "id": "openai/gpt-5.4-pro",
        "name": "GPT-5.4 Pro",
        "contextLength": 409600
      },
      {
        "id": "openai/gpt-5.4",
        "name": "GPT-5.4",
        "contextLength": 409600
      },
      {
        "id": "openai/gpt-5.4-mini",
        "name": "GPT-5.4 Mini",
        "contextLength": 409600
      },
      {
        "id": "openai/gpt-5.4-nano",
        "name": "GPT-5.4 Nano",
        "contextLength": 409600
      },
      {
        "id": "openai/gpt-5.3-codex",
        "name": "GPT-5.3 Codex",
        "contextLength": 409600
      },
      {
        "id": "openai/gpt-5.2-codex",
        "name": "GPT-5.2 Codex",
        "contextLength": 409600
      },
      {
        "id": "openai/gpt-5.2",
        "name": "GPT-5.2",
        "contextLength": 409600
      },
      {
        "id": "openai/gpt-5.1",
        "name": "GPT-5.1",
        "contextLength": 409600
      },
      {
        "id": "openai/gpt-5",
        "name": "GPT-5",
        "contextLength": 409600
      },
      {
        "id": "openai/gpt-4o",
        "name": "GPT-4o",
        "contextLength": 131072
      },
      {
        "id": "openai/gpt-4o-mini",
        "name": "GPT-4o Mini",
        "contextLength": 131072
      },
      {
        "id": "anthropic/claude-opus-4.7",
        "name": "Claude Opus 4.7",
        "contextLength": 409600
      },
      {
        "id": "anthropic/claude-opus-4.6",
        "name": "Claude Opus 4.6",
        "contextLength": 409600
      },
      {
        "id": "anthropic/claude-opus-4.5",
        "name": "Claude Opus 4.5",
        "contextLength": 409600
      },
      {
        "id": "anthropic/claude-opus-4.1",
        "name": "Claude Opus 4.1",
        "contextLength": 409600
      },
      {
        "id": "anthropic/claude-sonnet-4.6",
        "name": "Claude Sonnet 4.6",
        "contextLength": 409600
      },
      {
        "id": "anthropic/claude-sonnet-4.5",
        "name": "Claude Sonnet 4.5",
        "contextLength": 409600
      },
      {
        "id": "anthropic/claude-sonnet-4",
        "name": "Claude Sonnet 4",
        "contextLength": 409600
      },
      {
        "id": "anthropic/claude-haiku-4.5",
        "name": "Claude Haiku 4.5",
        "contextLength": 409600
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Pro",
        "name": "DeepSeek V4 Pro",
        "contextLength": 1048576,
        "supportsReasoning": true
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Flash",
        "name": "DeepSeek V4 Flash",
        "contextLength": 1048575,
        "supportsReasoning": true
      },
      {
        "id": "deepseek-ai/DeepSeek-R1-0528",
        "name": "DeepSeek R1",
        "contextLength": 163840,
        "supportsReasoning": true
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.2",
        "name": "DeepSeek V3.2",
        "contextLength": 163840
      },
      {
        "id": "google/gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro",
        "contextLength": 1048576
      },
      {
        "id": "google/gemini-3.1-flash-lite-preview",
        "name": "Gemini 3.1 Flash Lite",
        "contextLength": 1048576
      },
      {
        "id": "google/gemini-3-flash-preview",
        "name": "Gemini 3 Flash",
        "contextLength": 1048576
      },
      {
        "id": "zai-org/GLM-5.1-FP8",
        "name": "GLM-5.1",
        "contextLength": 202752
      },
      {
        "id": "zai-org/GLM-5-FP8",
        "name": "GLM-5",
        "contextLength": 202752
      },
      {
        "id": "moonshotai/Kimi-K2.6",
        "name": "Kimi K2.6",
        "contextLength": 65536
      },
      {
        "id": "moonshotai/Kimi-K2.5",
        "name": "Kimi K2.5",
        "contextLength": 262144
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.7",
        "name": "MiniMax M2.7",
        "contextLength": 196608
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.5",
        "name": "MiniMax M2.5",
        "contextLength": 196608
      },
      {
        "id": "Qwen/Qwen3.6-Max-Preview",
        "name": "Qwen3.6 Max",
        "contextLength": 262144
      },
      {
        "id": "Qwen/Qwen3.6-Plus",
        "name": "Qwen3.6 Plus",
        "contextLength": 262144
      },
      {
        "id": "Qwen/Qwen3.5-397B-A17B",
        "name": "Qwen3.5 397B",
        "contextLength": 262144
      },
      {
        "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8",
        "name": "Qwen3 Coder 480B",
        "contextLength": 262128
      },
      {
        "id": "nvidia/NVIDIA-Nemotron-3-Nano-Omni",
        "name": "Nemotron 3 Nano",
        "contextLength": 262144
      }
    ]
  },
  "gitlawb": {
    "id": "gitlawb",
    "alias": "glb",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://opengateway.gitlawb.com/v1/xiaomi-mimo",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "mimo-v2.5-pro",
        "name": "MiMo-V2.5-Pro",
        "contextLength": 1048576
      },
      {
        "id": "mimo-v2.5",
        "name": "MiMo-V2.5",
        "contextLength": 1048576
      },
      {
        "id": "mimo-v2-pro",
        "name": "MiMo-V2-Pro",
        "contextLength": 262144
      },
      {
        "id": "mimo-v2-omni",
        "name": "MiMo-V2-Omni",
        "contextLength": 262144
      },
      {
        "id": "mimo-v2-flash",
        "name": "MiMo-V2-Flash",
        "contextLength": 262144
      }
    ]
  },
  "liquid": {
    "id": "liquid",
    "alias": "liquid",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://inference.liquid.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "liquid-lfm-40b",
        "name": "Liquid LFM 40B"
      }
    ]
  },
  "deepinfra": {
    "id": "deepinfra",
    "alias": "deepinfra",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.deepinfra.com/v1/openai/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "anthropic/claude-4-opus",
        "name": "anthropic/claude-4-opus"
      },
      {
        "id": "anthropic/claude-4-sonnet",
        "name": "anthropic/claude-4-sonnet"
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "openai/gpt-oss-120b"
      },
      {
        "id": "openai/gpt-oss-20b",
        "name": "openai/gpt-oss-20b"
      },
      {
        "id": "google/gemma-4-31B-it",
        "name": "google/gemma-4-31B-it"
      },
      {
        "id": "google/gemma-4-26B-A4B-it",
        "name": "google/gemma-4-26B-A4B-it"
      },
      {
        "id": "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B",
        "name": "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B"
      },
      {
        "id": "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning",
        "name": "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning"
      },
      {
        "id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        "name": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8"
      },
      {
        "id": "meta-llama/Llama-4-Scout-17B-16E-Instruct",
        "name": "meta-llama/Llama-4-Scout-17B-16E-Instruct"
      },
      {
        "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "name": "meta-llama/Llama-3.3-70B-Instruct-Turbo"
      },
      {
        "id": "NousResearch/Hermes-3-Llama-3.1-405B",
        "name": "NousResearch/Hermes-3-Llama-3.1-405B"
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Pro",
        "name": "deepseek-ai/DeepSeek-V4-Pro"
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Flash",
        "name": "deepseek-ai/DeepSeek-V4-Flash"
      },
      {
        "id": "zai-org/GLM-5.1",
        "name": "zai-org/GLM-5.1"
      },
      {
        "id": "moonshotai/Kimi-K2.6",
        "name": "moonshotai/Kimi-K2.6"
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.5",
        "name": "MiniMaxAI/MiniMax-M2.5"
      },
      {
        "id": "Qwen/Qwen3.6-35B-A3B",
        "name": "Qwen/Qwen3.6-35B-A3B"
      },
      {
        "id": "Qwen/Qwen3.5-397B-A17B",
        "name": "Qwen/Qwen3.5-397B-A17B"
      },
      {
        "id": "Qwen/Qwen3.5-122B-A10B",
        "name": "Qwen/Qwen3.5-122B-A10B"
      },
      {
        "id": "XiaomiMiMo/MiMo-V2.5-Pro",
        "name": "XiaomiMiMo/MiMo-V2.5-Pro"
      },
      {
        "id": "XiaomiMiMo/MiMo-V2.5",
        "name": "XiaomiMiMo/MiMo-V2.5"
      }
    ]
  },
  "aihorde": {
    "id": "aihorde",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://oai.aihorde.net/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "aphrodite/TheDrummer/Cydonia-24B-v4.3",
        "name": "Cydonia 24B (AI Horde)",
        "contextLength": 32768,
        "toolCalling": false
      },
      {
        "id": "aphrodite/TheDrummer/Skyfall-31B-v4.2",
        "name": "Skyfall 31B (AI Horde)",
        "contextLength": 32768,
        "toolCalling": false
      },
      {
        "id": "google/gemma-4-31b",
        "name": "Gemma 4 31B (AI Horde)",
        "contextLength": 32768,
        "toolCalling": false
      }
    ]
  },
  "ainative": {
    "id": "ainative",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.ainative.studio/api/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "qwen3-235b-cerebras",
        "name": "Qwen3 235B (Cerebras)",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "qwen3-32b",
        "name": "Qwen3 32B",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "qwen3-14b",
        "name": "Qwen3 14B",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "qwen3-8b",
        "name": "Qwen3 8B",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "llama-4-maverick",
        "name": "Llama 4 Maverick",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "llama3.1-8b-cerebras",
        "name": "Llama 3.1 8B (Cerebras)",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "deepseek-r1",
        "name": "DeepSeek R1",
        "contextLength": 65536,
        "supportsReasoning": true
      },
      {
        "id": "nous-coder",
        "name": "Nous Coder",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "gemini-flash",
        "name": "Gemini Flash",
        "contextLength": 131072,
        "toolCalling": true
      }
    ]
  },
  "aion": {
    "id": "aion",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.aionlabs.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "aion-labs/aion-3.0",
        "name": "Aion 3.0",
        "contextLength": 131072
      },
      {
        "id": "aion-labs/aion-3.0-mini",
        "name": "Aion 3.0 Mini",
        "contextLength": 131072
      },
      {
        "id": "aion-labs/aion-2.5",
        "name": "Aion 2.5",
        "contextLength": 131072
      },
      {
        "id": "aion-labs/aion-2.0",
        "name": "Aion 2.0",
        "contextLength": 131072
      },
      {
        "id": "aion-labs/aion-rp-llama-3.1-8b",
        "name": "Aion RP Llama 3.1 8B",
        "contextLength": 32768
      }
    ]
  },
  "udio": {
    "id": "udio",
    "alias": "udio",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://www.udio.com/api/generate-proxy",
    "authType": "apikey",
    "authHeader": "cookie",
    "models": [
      {
        "id": "udio-default",
        "name": "Udio Default"
      }
    ]
  },
  "longcat": {
    "id": "longcat",
    "alias": "lc",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.longcat.chat/openai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "Authorization",
    "models": [
      {
        "id": "LongCat-2.0",
        "name": "LongCat 2.0 (10M tok free 🆓)",
        "contextLength": 1048576
      }
    ]
  },
  "morph": {
    "id": "morph",
    "alias": "morph",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.morphllm.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "morph-v3-large",
        "name": "morph-v3-large"
      },
      {
        "id": "morph-v3-fast",
        "name": "morph-v3-fast"
      },
      {
        "id": "morph-glm52-744b",
        "name": "GLM-5.2 744B (Morph)",
        "contextLength": 1048576
      },
      {
        "id": "morph-qwen35-397b",
        "name": "Qwen 3.5 397B (Morph)",
        "contextLength": 262144
      },
      {
        "id": "morph-qwen36-27b",
        "name": "Qwen 3.6 27B (Morph)",
        "contextLength": 131072
      },
      {
        "id": "morph-minimax3-428b",
        "name": "MiniMax M3 (Morph)",
        "contextLength": 262144
      },
      {
        "id": "morph-dsv4flash",
        "name": "DeepSeek V4 Flash (Morph)",
        "contextLength": 1048576
      }
    ]
  },
  "siliconflow": {
    "id": "siliconflow",
    "alias": "siliconflow",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.siliconflow.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "deepseek-ai/DeepSeek-V3.2",
        "name": "DeepSeek V3.2"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.2-Exp",
        "name": "DeepSeek V3.2 Exp"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.1",
        "name": "DeepSeek V3.1"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3.1-Terminus",
        "name": "DeepSeek V3.1 Terminus"
      },
      {
        "id": "deepseek-ai/DeepSeek-V3",
        "name": "DeepSeek V3"
      },
      {
        "id": "deepseek-ai/DeepSeek-R1",
        "name": "DeepSeek R1"
      },
      {
        "id": "deepseek-ai/deepseek-vl2",
        "name": "DeepSeek VL2"
      },
      {
        "id": "nex-agi/DeepSeek-V3.1-Nex-N1",
        "name": "DeepSeek V3.1 Nex N1"
      },
      {
        "id": "Qwen/Qwen3.6-35B-A3B",
        "name": "Qwen 3.6 35B A3B"
      },
      {
        "id": "Qwen/Qwen3.6-27B",
        "name": "Qwen 3.6 27B"
      },
      {
        "id": "Qwen/Qwen3.5-397B-A17B",
        "name": "Qwen 3.5 397B A17B"
      },
      {
        "id": "Qwen/Qwen3.5-122B-A10B",
        "name": "Qwen 3.5 122B A10B"
      },
      {
        "id": "Qwen/Qwen3.5-35B-A3B",
        "name": "Qwen 3.5 35B A3B"
      },
      {
        "id": "Qwen/Qwen3.5-27B",
        "name": "Qwen 3.5 27B"
      },
      {
        "id": "Qwen/Qwen3.5-9B",
        "name": "Qwen 3.5 9B"
      },
      {
        "id": "Qwen/Qwen3-Next-80B-A3B-Instruct",
        "name": "Qwen3 Next 80B Instruct"
      },
      {
        "id": "Qwen/Qwen3-Next-80B-A3B-Thinking",
        "name": "Qwen3 Next 80B Thinking"
      },
      {
        "id": "Qwen/Qwen3-235B-A22B",
        "name": "Qwen3 235B A22B"
      },
      {
        "id": "Qwen/Qwen3-235B-A22B-Instruct-2507",
        "name": "Qwen3 235B A22B Instruct"
      },
      {
        "id": "Qwen/Qwen3-235B-A22B-Thinking-2507",
        "name": "Qwen3 235B A22B Thinking"
      },
      {
        "id": "Qwen/Qwen3-32B",
        "name": "Qwen3 32B"
      },
      {
        "id": "Qwen/Qwen3-30B-A3B-Instruct-2507",
        "name": "Qwen3 30B A3B Instruct"
      },
      {
        "id": "Qwen/Qwen3-30B-A3B-Thinking-2507",
        "name": "Qwen3 30B A3B Thinking"
      },
      {
        "id": "Qwen/Qwen3-14B",
        "name": "Qwen3 14B"
      },
      {
        "id": "Qwen/Qwen3-8B",
        "name": "Qwen3 8B"
      },
      {
        "id": "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        "name": "Qwen3 Coder 480B"
      },
      {
        "id": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
        "name": "Qwen3 Coder 30B"
      },
      {
        "id": "Qwen/Qwen3-Omni-30B-A3B-Instruct",
        "name": "Qwen3 Omni 30B Instruct"
      },
      {
        "id": "Qwen/Qwen3-Omni-30B-A3B-Thinking",
        "name": "Qwen3 Omni 30B Thinking"
      },
      {
        "id": "Qwen/Qwen3-Omni-30B-A3B-Captioner",
        "name": "Qwen3 Omni 30B Captioner"
      },
      {
        "id": "Qwen/Qwen2.5-72B-Instruct",
        "name": "Qwen 2.5 72B"
      },
      {
        "id": "Qwen/Qwen2.5-72B-Instruct-128K",
        "name": "Qwen 2.5 72B 128K"
      },
      {
        "id": "Qwen/Qwen2.5-32B-Instruct",
        "name": "Qwen 2.5 32B"
      },
      {
        "id": "Qwen/Qwen2.5-14B-Instruct",
        "name": "Qwen 2.5 14B"
      },
      {
        "id": "Qwen/Qwen2.5-7B-Instruct",
        "name": "Qwen 2.5 7B"
      },
      {
        "id": "Qwen/Qwen2.5-VL-7B-Instruct",
        "name": "Qwen 2.5 VL 7B"
      },
      {
        "id": "zai-org/GLM-5.1",
        "name": "GLM 5.1"
      },
      {
        "id": "zai-org/GLM-5",
        "name": "GLM 5"
      },
      {
        "id": "zai-org/GLM-5V-Turbo",
        "name": "GLM 5V Turbo"
      },
      {
        "id": "zai-org/GLM-4.7",
        "name": "GLM 4.7"
      },
      {
        "id": "zai-org/GLM-4.6",
        "name": "GLM 4.6"
      },
      {
        "id": "zai-org/GLM-4.6V",
        "name": "GLM 4.6V"
      },
      {
        "id": "zai-org/GLM-4.5",
        "name": "GLM 4.5"
      },
      {
        "id": "zai-org/GLM-4.5-Air",
        "name": "GLM 4.5 Air"
      },
      {
        "id": "zai-org/GLM-4.5V",
        "name": "GLM 4.5V"
      },
      {
        "id": "THUDM/GLM-4-32B-0414",
        "name": "GLM 4 32B"
      },
      {
        "id": "THUDM/GLM-4-9B-0414",
        "name": "GLM 4 9B"
      },
      {
        "id": "THUDM/GLM-Z1-32B-0414",
        "name": "GLM Z1 32B"
      },
      {
        "id": "THUDM/GLM-Z1-9B-0414",
        "name": "GLM Z1 9B"
      },
      {
        "id": "moonshotai/Kimi-K2.6",
        "name": "Kimi K2.6"
      },
      {
        "id": "moonshotai/Kimi-K2.5",
        "name": "Kimi K2.5"
      },
      {
        "id": "moonshotai/Kimi-K2-Instruct",
        "name": "Kimi K2 Instruct"
      },
      {
        "id": "moonshotai/Kimi-K2-Instruct-0905",
        "name": "Kimi K2 Instruct 0905"
      },
      {
        "id": "moonshotai/Kimi-K2-Thinking",
        "name": "Kimi K2 Thinking"
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "GPT OSS 120B"
      },
      {
        "id": "openai/gpt-oss-20b",
        "name": "GPT OSS 20B"
      },
      {
        "id": "baidu/ERNIE-4.5-300B-A47B",
        "name": "ERNIE 4.5 300B"
      },
      {
        "id": "tencent/Hunyuan-A13B-Instruct",
        "name": "Hunyuan A13B"
      },
      {
        "id": "tencent/Hunyuan-MT-7B",
        "name": "Hunyuan MT 7B"
      },
      {
        "id": "tencent/Hy3-preview",
        "name": "Hunyuan Hy3 Preview"
      },
      {
        "id": "meta-llama/Meta-Llama-3.1-8B-Instruct",
        "name": "Llama 3.1 8B"
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.1",
        "name": "MiniMax M2.1"
      },
      {
        "id": "inclusionAI/Ling-flash-2.0",
        "name": "Ling Flash 2.0"
      },
      {
        "id": "inclusionAI/Ling-mini-2.0",
        "name": "Ling Mini 2.0"
      },
      {
        "id": "inclusionAI/Ring-flash-2.0",
        "name": "Ring Flash 2.0"
      },
      {
        "id": "google/gemma-4-31B-it",
        "name": "Gemma 4 31B"
      },
      {
        "id": "google/gemma-4-26B-A4B-it",
        "name": "Gemma 4 26B"
      },
      {
        "id": "ByteDance-Seed/Seed-OSS-36B-Instruct",
        "name": "Seed OSS 36B"
      }
    ]
  },
  "novita": {
    "id": "novita",
    "alias": "novita",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.novita.ai/openai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "deepseek/deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "contextLength": 1048576,
        "supportsReasoning": true
      },
      {
        "id": "deepseek/deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "contextLength": 1048576,
        "supportsReasoning": true
      },
      {
        "id": "deepseek/deepseek-v3.2",
        "name": "DeepSeek V3.2",
        "contextLength": 163840,
        "supportsReasoning": true
      },
      {
        "id": "moonshotai/kimi-k3",
        "name": "Kimi K3",
        "contextLength": 1048576,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "moonshotai/kimi-k2.7-code",
        "name": "Kimi K2.7 Code",
        "contextLength": 262144,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "moonshotai/kimi-k2.6",
        "name": "Kimi K2.6",
        "contextLength": 262144,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "zai-org/glm-5.2",
        "name": "GLM 5.2",
        "contextLength": 1048576,
        "supportsReasoning": true
      },
      {
        "id": "zai-org/glm-5.1",
        "name": "GLM 5.1",
        "contextLength": 204800,
        "supportsReasoning": true
      },
      {
        "id": "zai-org/glm-4.7",
        "name": "GLM 4.7",
        "contextLength": 204800,
        "supportsReasoning": true
      },
      {
        "id": "minimax/minimax-m3",
        "name": "MiniMax M3",
        "contextLength": 1000000,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "minimax/minimax-m2.7",
        "name": "MiniMax M2.7",
        "contextLength": 204800,
        "supportsReasoning": true
      },
      {
        "id": "qwen/qwen3.7-max",
        "name": "Qwen3.7 Max",
        "contextLength": 1000000,
        "supportsReasoning": true
      },
      {
        "id": "qwen/qwen3.6-plus",
        "name": "Qwen3.6 Plus",
        "contextLength": 1000000,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "qwen/qwen3.5-397b-a17b",
        "name": "Qwen3.5 397B A17B",
        "contextLength": 262144,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "qwen/qwen3-coder-480b-a35b-instruct",
        "name": "Qwen3 Coder 480B",
        "contextLength": 262144
      },
      {
        "id": "xiaomimimo/mimo-v2.5-pro",
        "name": "MiMo V2.5 Pro",
        "contextLength": 1048576,
        "supportsReasoning": true
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "OpenAI gpt-oss-120b",
        "contextLength": 131072,
        "supportsReasoning": true
      },
      {
        "id": "google/gemma-4-31b-it",
        "name": "Gemma 4 31B",
        "contextLength": 262144,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "meta-llama/llama-3.1-8b-instruct",
        "name": "Llama 3.1 8B Instruct",
        "contextLength": 16384
      }
    ]
  },
  "regolo": {
    "id": "regolo",
    "alias": "regolo",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.regolo.ai",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "regolo-chat",
        "name": "Regolo Chat"
      },
      {
        "id": "regolo-fast",
        "name": "Regolo Fast"
      }
    ]
  },
  "nanogpt": {
    "id": "nanogpt",
    "alias": "nanogpt",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://nano-gpt.com/api/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "chatgpt-4o-latest",
        "name": "chatgpt-4o-latest"
      },
      {
        "id": "claude-3.5-sonnet",
        "name": "claude-3.5-sonnet"
      },
      {
        "id": "gpt-4o-mini",
        "name": "gpt-4o-mini"
      }
    ]
  },
  "scaleway": {
    "id": "scaleway",
    "alias": "scw",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.scaleway.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "qwen3-235b-a22b-instruct-2507",
        "name": "Qwen3 235B A22B (1M free tok 🆓)"
      },
      {
        "id": "llama-3.1-70b-instruct",
        "name": "Llama 3.1 70B (🆓 EU)"
      },
      {
        "id": "llama-3.1-8b-instruct",
        "name": "Llama 3.1 8B (🆓 EU)"
      },
      {
        "id": "mistral-small-3.2-24b-instruct-2506",
        "name": "Mistral Small 3.2 (🆓 EU)"
      },
      {
        "id": "deepseek-v3-0324",
        "name": "DeepSeek V3 (🆓 EU)"
      },
      {
        "id": "gpt-oss-120b",
        "name": "GPT-OSS 120B (🆓 EU)"
      }
    ]
  },
  "galadriel": {
    "id": "galadriel",
    "alias": "galadriel",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.galadriel.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "galadriel-latest",
        "name": "galadriel-latest"
      }
    ]
  },
  "qianfan": {
    "id": "qianfan",
    "alias": "qianfan",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://qianfan.baidubce.com/v2/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "ernie-5.1",
        "name": "ERNIE 5.1"
      },
      {
        "id": "ernie-5.0-thinking-latest",
        "name": "ERNIE 5.0 Thinking Latest"
      },
      {
        "id": "ernie-x1.1",
        "name": "ERNIE X1.1",
        "contextLength": 64000
      }
    ]
  },
  "meta-llama": {
    "id": "meta-llama",
    "alias": "meta",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.llama.com/compat/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "Llama-4-Maverick-17B-128E-Instruct-FP8",
        "name": "Llama-4-Maverick-17B-128E-Instruct-FP8"
      },
      {
        "id": "Llama-4-Scout-17B-16E-Instruct-FP8",
        "name": "Llama-4-Scout-17B-16E-Instruct-FP8"
      },
      {
        "id": "Llama-3.3-70B-Instruct",
        "name": "Llama-3.3-70B-Instruct"
      },
      {
        "id": "Llama-3.3-8B-Instruct",
        "name": "Llama-3.3-8B-Instruct"
      }
    ]
  },
  "nous-research": {
    "id": "nous-research",
    "alias": "nous",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://inference-api.nousresearch.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "Hermes-4-405B",
        "name": "Hermes 4 7B (Nous Research)"
      },
      {
        "id": "Hermes-4-70B",
        "name": "Hermes 4 70B (Nous Research)"
      }
    ]
  },
  "alibaba": {
    "id": "alibaba",
    "alias": "ali",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "qwen3.7-max",
        "name": "Qwen3.7 Max"
      },
      {
        "id": "qwen3.7-plus",
        "name": "Qwen3.7 Plus"
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen3.6 Plus"
      },
      {
        "id": "qwen3.6-27b",
        "name": "Qwen3.6 27B"
      },
      {
        "id": "qwen3.6-35b-a3b",
        "name": "Qwen3.6 35B A3B"
      },
      {
        "id": "qwen3.5-plus",
        "name": "Qwen3.5 Plus"
      },
      {
        "id": "qwen3.5-122b-a10b",
        "name": "Qwen3.5 122B A10B"
      },
      {
        "id": "qwen3.5-397b-a17b",
        "name": "Qwen3.5 397B A17B"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.2-fast-preview",
        "name": "GLM 5.2 Fast Preview"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      }
    ]
  },
  "alibaba-cn": {
    "id": "alibaba-cn",
    "alias": "ali-cn",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "qwen3.7-max",
        "name": "Qwen3.7 Max"
      },
      {
        "id": "qwen3.7-plus",
        "name": "Qwen3.7 Plus"
      },
      {
        "id": "qwen3.6-plus",
        "name": "Qwen3.6 Plus"
      },
      {
        "id": "qwen3.6-27b",
        "name": "Qwen3.6 27B"
      },
      {
        "id": "qwen3.6-35b-a3b",
        "name": "Qwen3.6 35B A3B"
      },
      {
        "id": "qwen3.5-plus",
        "name": "Qwen3.5 Plus"
      },
      {
        "id": "qwen3.5-122b-a10b",
        "name": "Qwen3.5 122B A10B"
      },
      {
        "id": "qwen3.5-397b-a17b",
        "name": "Qwen3.5 397B A17B"
      },
      {
        "id": "glm-5.2",
        "name": "GLM 5.2"
      },
      {
        "id": "glm-5.2-fast-preview",
        "name": "GLM 5.2 Fast Preview"
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro"
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash"
      },
      {
        "id": "kimi-k2.7-code",
        "name": "Kimi K2.7 Code"
      }
    ]
  },
  "doubao": {
    "id": "doubao",
    "alias": "doubao",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "doubao-seed-2-0-pro-260215",
        "name": "Doubao Seed 2.0 Pro",
        "contextLength": 262144
      },
      {
        "id": "doubao-seed-2-0-lite-260215",
        "name": "Doubao Seed 2.0 Lite",
        "contextLength": 262144
      },
      {
        "id": "doubao-seed-2-0-mini-260215",
        "name": "Doubao Seed 2.0 Mini",
        "contextLength": 262144
      },
      {
        "id": "doubao-seed-2-0-code-preview-260215",
        "name": "Doubao Seed 2.0 Code",
        "contextLength": 262144
      },
      {
        "id": "doubao-seed-1-8-251228",
        "name": "Doubao Seed 1.8",
        "contextLength": 262144
      },
      {
        "id": "doubao-seed-1-6-251015",
        "name": "Doubao Seed 1.6",
        "contextLength": 262144
      },
      {
        "id": "doubao-seed-1-6-flash-250828",
        "name": "Doubao Seed 1.6 Flash",
        "contextLength": 262144
      },
      {
        "id": "doubao-1-5-pro-32k-250115",
        "name": "Doubao 1.5 Pro 32K",
        "contextLength": 32768
      },
      {
        "id": "doubao-pro-32k",
        "name": "Doubao Pro 32K"
      }
    ]
  },
  "gigachat": {
    "id": "gigachat",
    "alias": "gigachat",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://gigachat.devices.sberbank.ru/api/v1",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "GigaChat-2-Max",
        "name": "GigaChat-2-Max"
      },
      {
        "id": "GigaChat-2-Pro",
        "name": "GigaChat-2-Pro"
      },
      {
        "id": "GigaChat-2-Lite",
        "name": "GigaChat-2-Lite"
      }
    ]
  },
  "chutes": {
    "id": "chutes",
    "alias": "chutes",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://llm.chutes.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "Qwen2.5-72B-Instruct",
        "name": "Qwen2.5 72B"
      }
    ]
  },
  "factory": {
    "id": "factory",
    "alias": "factory",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.factory.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "auto",
        "name": "Factory Auto (best model)"
      }
    ]
  },
  "databricks": {
    "id": "databricks",
    "alias": "databricks",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://adb-0000000000000000.0.azuredatabricks.net/serving-endpoints",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "databricks-gpt-5",
        "name": "databricks-gpt-5"
      },
      {
        "id": "databricks-meta-llama-3-3-70b-instruct",
        "name": "databricks-meta-llama-3-3-70b-instruct"
      },
      {
        "id": "databricks-claude-sonnet-4",
        "name": "databricks-claude-sonnet-4"
      },
      {
        "id": "databricks-gemini-2-5-pro",
        "name": "databricks-gemini-2-5-pro"
      }
    ]
  },
  "reka": {
    "id": "reka",
    "alias": "reka",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.reka.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "reka-flash-3",
        "name": "Reka Flash 3"
      },
      {
        "id": "reka-flash",
        "name": "Reka Flash"
      },
      {
        "id": "reka-edge-2603",
        "name": "Reka Edge 2603"
      }
    ]
  },
  "typhoon": {
    "id": "typhoon",
    "alias": "typhoon",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.opentyphoon.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "typhoon-v2.5-30b-a3b-instruct",
        "name": "Typhoon v2.5 30B A3B Instruct",
        "contextLength": 131072
      }
    ]
  },
  "inception": {
    "id": "inception",
    "alias": "inception",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.inceptionlabs.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "mercury-2",
        "name": "Mercury 2",
        "contextLength": 128000
      }
    ]
  },
  "sarvam": {
    "id": "sarvam",
    "alias": "sarvam",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.sarvam.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "sarvam-105b",
        "name": "Sarvam 105B",
        "contextLength": 131072
      },
      {
        "id": "sarvam-30b",
        "name": "Sarvam 30B",
        "contextLength": 65536
      }
    ]
  },
  "writer": {
    "id": "writer",
    "alias": "writer",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.writer.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "palmyra-x5",
        "name": "Palmyra X5",
        "contextLength": 1048576
      },
      {
        "id": "palmyra-x4",
        "name": "Palmyra X4",
        "contextLength": 131072
      }
    ]
  },
  "plamo": {
    "id": "plamo",
    "alias": "plamo",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.platform.preferredai.jp/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "plamo-3.0-prime",
        "name": "PLaMo 3.0 Prime",
        "contextLength": 262144
      }
    ]
  },
  "clova-studio": {
    "id": "clova-studio",
    "alias": "clova",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://clovastudio.stream.ntruss.com/v1/openai/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "HCX-007",
        "name": "HCX-007"
      },
      {
        "id": "HCX-005",
        "name": "HCX-005"
      }
    ]
  },
  "internlm": {
    "id": "internlm",
    "alias": "internlm",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://chat.intern-ai.org.cn/api/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "intern-s1-pro",
        "name": "Intern-S1 Pro"
      },
      {
        "id": "intern-s1",
        "name": "Intern-S1"
      },
      {
        "id": "intern-s1-mini",
        "name": "Intern-S1 Mini"
      },
      {
        "id": "internvl3.5-latest",
        "name": "InternVL3.5 Latest"
      },
      {
        "id": "intern-latest",
        "name": "Intern Latest"
      }
    ]
  },
  "ant-ling": {
    "id": "ant-ling",
    "alias": "ling",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.ant-ling.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "Ling-2.6-1T",
        "name": "Ling 2.6 1T"
      },
      {
        "id": "Ring-2.6-1T",
        "name": "Ring 2.6 1T"
      },
      {
        "id": "Ling-2.6-flash",
        "name": "Ling 2.6 Flash"
      }
    ]
  },
  "vercel-ai-gateway": {
    "id": "vercel-ai-gateway",
    "alias": "vag",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://ai-gateway.vercel.sh/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "openai/gpt-4.1",
        "name": "openai/gpt-4.1"
      },
      {
        "id": "anthropic/claude-4-sonnet",
        "name": "anthropic/claude-4-sonnet"
      },
      {
        "id": "google/gemini-2.5-pro",
        "name": "google/gemini-2.5-pro"
      },
      {
        "id": "moonshotai/kimi-k2",
        "name": "moonshotai/kimi-k2"
      },
      {
        "id": "vercel/v0-1.5-md",
        "name": "vercel/v0-1.5-md"
      }
    ]
  },
  "v0-vercel": {
    "id": "v0-vercel",
    "alias": "v0",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.v0.dev/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "v0-1.0-md",
        "name": "v0-1.0-md"
      },
      {
        "id": "v0-1.5-lg",
        "name": "v0-1.5-lg"
      },
      {
        "id": "v0-1.5-md",
        "name": "v0-1.5-md"
      }
    ]
  },
  "maritalk": {
    "id": "maritalk",
    "alias": "maritalk",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://chat.maritaca.ai/api",
    "authType": "apikey",
    "authHeader": "key",
    "models": [
      {
        "id": "sabia-4",
        "name": "sabia-4"
      },
      {
        "id": "sabia-4-thinking",
        "name": "sabia-4-thinking"
      },
      {
        "id": "sabiazinho-4",
        "name": "sabiazinho-4"
      }
    ]
  },
  "baseten": {
    "id": "baseten",
    "alias": "baseten",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://inference.baseten.co/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "moonshotai/Kimi-K2.6",
        "name": "moonshotai/Kimi-K2.6"
      },
      {
        "id": "deepseek-ai/DeepSeek-V4-Pro",
        "name": "deepseek-ai/DeepSeek-V4-Pro"
      },
      {
        "id": "zai-org/GLM-5",
        "name": "zai-org/GLM-5"
      },
      {
        "id": "MiniMaxAI/MiniMax-M2.5",
        "name": "MiniMaxAI/MiniMax-M2.5"
      },
      {
        "id": "nvidia/Nemotron-120B-A12B",
        "name": "nvidia/Nemotron-120B-A12B"
      },
      {
        "id": "openai/gpt-oss-120b",
        "name": "openai/gpt-oss-120b"
      }
    ]
  },
  "heroku": {
    "id": "heroku",
    "alias": "heroku",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://us.inference.heroku.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "claude-opus-4-7",
        "name": "claude-opus-4-7"
      },
      {
        "id": "claude-4-6-sonnet",
        "name": "claude-4-6-sonnet"
      },
      {
        "id": "claude-4-5-haiku",
        "name": "claude-4-5-haiku"
      },
      {
        "id": "glm-4-7",
        "name": "glm-4-7"
      },
      {
        "id": "kimi-k2-5",
        "name": "kimi-k2-5"
      },
      {
        "id": "minimax-m2-1",
        "name": "minimax-m2-1"
      },
      {
        "id": "deepseek-v3-2",
        "name": "deepseek-v3-2"
      },
      {
        "id": "qwen3-coder-480b",
        "name": "qwen3-coder-480b"
      },
      {
        "id": "qwen3-235b",
        "name": "qwen3-235b"
      },
      {
        "id": "gpt-oss-120b",
        "name": "gpt-oss-120b"
      },
      {
        "id": "nova-pro",
        "name": "nova-pro"
      },
      {
        "id": "nova-2-lite",
        "name": "nova-2-lite"
      }
    ]
  },
  "bluesminds": {
    "id": "bluesminds",
    "alias": "bm",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.bluesminds.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "gpt-4o",
        "name": "GPT-4o"
      },
      {
        "id": "gpt-4o-mini",
        "name": "GPT-4o Mini"
      },
      {
        "id": "gpt-4.1",
        "name": "GPT-4.1"
      },
      {
        "id": "gpt-4.1-mini",
        "name": "GPT-4.1 Mini"
      },
      {
        "id": "gpt-4.1-nano",
        "name": "GPT-4.1 Nano"
      },
      {
        "id": "claude-sonnet-4-5",
        "name": "Claude Sonnet 4.5"
      },
      {
        "id": "claude-haiku-4-5",
        "name": "Claude Haiku 4.5"
      },
      {
        "id": "gemini-2.0-flash",
        "name": "Gemini 2.0 Flash"
      },
      {
        "id": "gemini-2.0-flash-exp",
        "name": "Gemini 2.0 Flash (Exp)"
      },
      {
        "id": "deepseek-reasoner",
        "name": "DeepSeek Reasoner",
        "supportsReasoning": true
      },
      {
        "id": "deepseek-chat",
        "name": "DeepSeek Chat"
      },
      {
        "id": "qwen-plus",
        "name": "Qwen Plus"
      },
      {
        "id": "qwen-turbo",
        "name": "Qwen Turbo"
      },
      {
        "id": "kimi-k2",
        "name": "Kimi K2"
      },
      {
        "id": "kimi-k2-thinking",
        "name": "Kimi K2 Thinking"
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      },
      {
        "id": "glm-4-flash",
        "name": "GLM 4 Flash"
      },
      {
        "id": "minimax-m2.5",
        "name": "MiniMax M2.5"
      },
      {
        "id": "claude-opus-4-5",
        "name": "Claude Opus 4.5 (VIP)",
        "contextLength": 200000
      },
      {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro (VIP)",
        "contextLength": 1048576
      },
      {
        "id": "grok-3",
        "name": "Grok-3 (VIP)",
        "contextLength": 131072
      },
      {
        "id": "qwen-max",
        "name": "Qwen Max (VIP)"
      }
    ]
  },
  "baidu": {
    "id": "baidu",
    "alias": "baidu",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://qianfan.baidubce.com/v2/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "ernie-5.1",
        "name": "ERNIE 5.1",
        "contextLength": 131072
      },
      {
        "id": "ernie-5.0",
        "name": "ERNIE 5.0",
        "contextLength": 131072
      },
      {
        "id": "ernie-x1.1",
        "name": "ERNIE X1.1",
        "contextLength": 32768
      },
      {
        "id": "ernie-4.5-turbo-128k",
        "name": "ERNIE 4.5 Turbo 128K",
        "contextLength": 131072
      },
      {
        "id": "ernie-4.5-turbo-32k",
        "name": "ERNIE 4.5 Turbo 32K",
        "contextLength": 32768
      },
      {
        "id": "ernie-4.5-turbo-vl",
        "name": "ERNIE 4.5 Turbo VL",
        "contextLength": 131072
      },
      {
        "id": "ernie-4.5-21b-a3b",
        "name": "ERNIE 4.5 21B A3B",
        "contextLength": 131072
      },
      {
        "id": "ernie-4.5-0.3b",
        "name": "ERNIE 4.5 0.3B",
        "contextLength": 131072
      },
      {
        "id": "ernie-4.0-8k",
        "name": "ERNIE 4.0 8K"
      },
      {
        "id": "ernie-4.0-turbo-128k",
        "name": "ERNIE 4.0 Turbo 128K",
        "contextLength": 131072
      },
      {
        "id": "ernie-4.0-turbo-8k",
        "name": "ERNIE 4.0 Turbo 8K",
        "contextLength": 8192
      },
      {
        "id": "ernie-3.5-8k",
        "name": "ERNIE 3.5 8K",
        "contextLength": 8192
      },
      {
        "id": "ernie-speed-128k",
        "name": "ERNIE Speed 128K",
        "contextLength": 131072
      },
      {
        "id": "ernie-speed-8k",
        "name": "ERNIE Speed 8K",
        "contextLength": 8192
      },
      {
        "id": "ernie-lite-8k",
        "name": "ERNIE Lite 8K",
        "contextLength": 8192
      },
      {
        "id": "ernie-tiny-8k",
        "name": "ERNIE Tiny 8K",
        "contextLength": 8192
      }
    ]
  },
  "venice": {
    "id": "venice",
    "alias": "venice",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.venice.ai/api/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "venice-latest",
        "name": "venice-latest"
      }
    ]
  },
  "byteplus": {
    "id": "byteplus",
    "alias": "bpm",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "seed-2.0",
        "name": "Seed 2.0"
      },
      {
        "id": "kimi-k2-thinking",
        "name": "Kimi K2 Thinking",
        "supportsReasoning": true
      },
      {
        "id": "glm-4.7",
        "name": "GLM 4.7"
      },
      {
        "id": "gpt-oss-120b",
        "name": "GPT-OSS-120B"
      }
    ]
  },
  "openadapter": {
    "id": "openadapter",
    "alias": "oad",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.openadapter.in/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "glm-4.7",
        "name": "GLM 4.7 (OpenAdapter)",
        "contextLength": 128000,
        "toolCalling": true
      }
    ]
  },
  "dit": {
    "id": "dit",
    "alias": "dai",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.dit.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 200000,
    "models": [
      {
        "id": "gpt-5.4",
        "name": "GPT-5.4 (DIT.ai)",
        "contextLength": 400000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6 (DIT.ai)",
        "contextLength": 200000,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      }
    ]
  },
  "tokenrouter": {
    "id": "tokenrouter",
    "alias": "trk",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.tokenrouter.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "defaultContextLength": 128000,
    "models": [
      {
        "id": "minimax-3",
        "name": "MiniMax 3 (free, TokenRouter)",
        "contextLength": 128000,
        "toolCalling": true
      },
      {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro (TokenRouter)",
        "contextLength": 163840,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash (TokenRouter)",
        "contextLength": 163840,
        "toolCalling": true,
        "supportsReasoning": true
      }
    ]
  },
  "pioneer": {
    "id": "pioneer",
    "alias": "pn",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.pioneer.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "x-api-key",
    "models": [
      {
        "id": "Qwen/Qwen3-32B",
        "name": "Qwen3 32B"
      },
      {
        "id": "Qwen/Qwen3.6-27B",
        "name": "Qwen3.6 27B"
      },
      {
        "id": "Qwen/Qwen3.5-9B",
        "name": "Qwen3.5 9B"
      },
      {
        "id": "Qwen/Qwen3-8B",
        "name": "Qwen3 8B"
      },
      {
        "id": "Qwen/Qwen3-4B-Base",
        "name": "Qwen3 4B Base"
      },
      {
        "id": "Qwen/Qwen3-1.7B-Base",
        "name": "Qwen3 1.7B Base"
      },
      {
        "id": "meta-llama/Llama-3.1-8B-Instruct",
        "name": "Llama 3.1 8B Instruct"
      },
      {
        "id": "meta-llama/Llama-3.2-1B-Instruct",
        "name": "Llama 3.2 1B Instruct"
      },
      {
        "id": "google/gemma-3-4b-pt",
        "name": "Gemma 3 4B (Pretrained)"
      },
      {
        "id": "HuggingFaceTB/SmolLM3-3B-Base",
        "name": "SmolLM3 3B Base"
      }
    ]
  },
  "navy": {
    "id": "navy",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.navy/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "llama-3.3-70b-instruct",
        "name": "Llama 3.3 70B Instruct",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "gemma-4-31b-it",
        "name": "Gemma 4 31B IT",
        "contextLength": 262144,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "contextLength": 1048576,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "deepseek-chat",
        "name": "DeepSeek Chat",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "mistral-small-latest",
        "name": "Mistral Small",
        "contextLength": 262144,
        "toolCalling": true,
        "supportsVision": true,
        "supportsReasoning": true
      },
      {
        "id": "llama-4-scout",
        "name": "Llama 4 Scout",
        "contextLength": 10000000,
        "toolCalling": true,
        "supportsVision": true
      }
    ]
  },
  "nara": {
    "id": "nara",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://router.bynara.id/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "tencent-hy3",
        "name": "Tencent Hy3",
        "contextLength": 1000000
      },
      {
        "id": "mistral-large",
        "name": "Mistral Large",
        "contextLength": 252000,
        "toolCalling": true
      },
      {
        "id": "mistral-medium-3-5",
        "name": "Mistral Medium 3.5",
        "contextLength": 256000,
        "toolCalling": true,
        "supportsVision": true
      }
    ]
  },
  "sealion": {
    "id": "sealion",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.sea-lion.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "models": [
      {
        "id": "aisingapore/Llama-SEA-LION-v3.5-70B-R",
        "name": "Llama SEA-LION v3.5 70B R",
        "contextLength": 131072
      },
      {
        "id": "aisingapore/Llama-SEA-LION-v3-70B-IT",
        "name": "Llama SEA-LION v3 70B IT",
        "contextLength": 131072
      },
      {
        "id": "aisingapore/Gemma-SEA-LION-v4-27B-IT",
        "name": "Gemma SEA-LION v4 27B IT",
        "contextLength": 131072
      },
      {
        "id": "aisingapore/Qwen-SEA-LION-v4.5-27B-IT",
        "name": "Qwen SEA-LION v4.5 27B IT",
        "contextLength": 32768
      },
      {
        "id": "aisingapore/Qwen-SEA-LION-v4-32B-IT",
        "name": "Qwen SEA-LION v4 32B IT",
        "contextLength": 32768
      }
    ]
  },
  "routeway": {
    "id": "routeway",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.routeway.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "llama-3.3-70b-instruct:free",
        "name": "Llama 3.3 70B Instruct (free)",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "nemotron-3-nano-30b-a3b:free",
        "name": "Nemotron 3 Nano 30B (free)",
        "contextLength": 256000,
        "toolCalling": true
      },
      {
        "id": "nemotron-nano-9b-v2:free",
        "name": "Nemotron Nano 9B v2 (free)",
        "contextLength": 128000,
        "toolCalling": true
      },
      {
        "id": "step-3.7-flash:free",
        "name": "Step 3.7 Flash (free)",
        "contextLength": 256000,
        "toolCalling": true,
        "supportsVision": true
      },
      {
        "id": "step-3.5-flash:free",
        "name": "Step 3.5 Flash (free)",
        "contextLength": 65536,
        "toolCalling": true
      },
      {
        "id": "laguna-m.1:free",
        "name": "Laguna M.1 (free)",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "laguna-xs.2:free",
        "name": "Laguna XS.2 (free)",
        "contextLength": 131072,
        "toolCalling": true
      },
      {
        "id": "llama-3.2-3b-instruct:free",
        "name": "Llama 3.2 3B Instruct (free)",
        "contextLength": 16000,
        "toolCalling": true
      }
    ]
  },
  "poolside": {
    "id": "poolside",
    "alias": "poolside",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://inference.poolside.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "poolside/laguna-xs-2.1",
        "name": "Laguna XS 2.1",
        "contextLength": 262144,
        "toolCalling": true,
        "supportsReasoning": true
      },
      {
        "id": "poolside/laguna-s-2.1",
        "name": "Laguna S 2.1",
        "contextLength": 262144,
        "toolCalling": true,
        "supportsReasoning": true
      }
    ]
  },
  "llm-kiwi": {
    "id": "llm-kiwi",
    "alias": "llmkiwi",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.llm.kiwi/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "auto",
        "name": "Auto"
      },
      {
        "id": "hrLLM",
        "name": "hrLLM"
      }
    ]
  },
  "mixlayer": {
    "id": "mixlayer",
    "alias": "mixlayer",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://models.mixlayer.ai/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "qwen/qwen3.5-4b-free",
        "name": "Qwen 3.5 4B (free)"
      }
    ]
  },
  "yolo-auto": {
    "id": "yolo-auto",
    "alias": "yolo-auto",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://yolo-auto.com/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "qwen3.6-35b-a3b",
        "name": "Qwen 3.6 35B A3B"
      }
    ]
  },
  "cloudcode-one": {
    "id": "cloudcode-one",
    "alias": "cloudcode-one",
    "format": "openai",
    "executor": "default",
    "baseUrl": "https://api.cloudcode.one/v1/chat/completions",
    "authType": "apikey",
    "authHeader": "bearer",
    "passthroughModels": true,
    "models": [
      {
        "id": "glm-4.7-flash",
        "name": "GLM 4.7 Flash"
      },
      {
        "id": "glm-4.6v-flash",
        "name": "GLM 4.6V Flash"
      }
    ]
  }
};

function listProviderIds() {
  return Object.keys(REGISTRY);
}

function getProvider(id) {
  if (!id) return null;
  return REGISTRY[String(id).toLowerCase()] || null;
}

/** Resolve the chat-completions URL for a registry provider. */
function resolveBaseUrl(id) {
  const entry = getProvider(id);
  return entry ? entry.baseUrl : null;
}

/** Build the `{ group, models }` shape Proxy-Max's models.js/dashboard expects. */
function toModelGroups(id) {
  const entry = getProvider(id);
  if (!entry) return [];
  return [{
    group: entry.alias || entry.id,
    models: entry.models.map(m => ({ id: m.id, label: m.name || m.id })),
  }];
}

/** Full catalog in models.js's `{ providerId: [{group, models}] }` shape. */
function toFullCatalog() {
  const out = {};
  for (const id of listProviderIds()) out[id] = toModelGroups(id);
  return out;
}

module.exports = {
  REGISTRY,
  listProviderIds,
  getProvider,
  resolveBaseUrl,
  toModelGroups,
  toFullCatalog,
};
