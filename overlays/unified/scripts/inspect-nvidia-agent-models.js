#!/usr/bin/env node

import {
  getNvidiaCatalogModels,
  isNvidiaClaudeToolModelId,
  selectNvidiaClaudeRouteModels,
} from "@/lib/nvidiaCatalog.js";

const models = await getNvidiaCatalogModels();
console.log(JSON.stringify({
  catalogCount: models.length,
  preferred: selectNvidiaClaudeRouteModels(models, 20),
  agentCandidates: models.filter(isNvidiaClaudeToolModelId).sort(),
}, null, 2));
