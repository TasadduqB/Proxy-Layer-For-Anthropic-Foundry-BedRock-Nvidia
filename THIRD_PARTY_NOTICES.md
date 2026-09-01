# Third-party notices

## OmniRoute

Proxy-Max adapts logic from OmniRoute by diegosouzapw and contributors:
the free-tier model catalog (`src/free-models.js`), a generic OpenAI-compatible
provider registry (`src/providers/registry.js`), request guardrails —
prompt-injection detection, PII detection/redaction, credential/secret masking
(`src/security/guardrails.js`) — and an adaptive circuit breaker
(`src/routing/circuit-breaker.js`).

- Source: <https://github.com/diegosouzapw/OmniRoute>
- License: MIT
- Copyright (c) 2026 diegosouzapw

The original copyright and permission notice apply to those components.
Proxy-Max changes and integration code remain covered by Proxy-Max's own
license unless a file states otherwise.

## 9router

Proxy-Max includes and adapts the tracked source distribution of 9router
v0.5.40 by decolua and contributors.

- Source: <https://github.com/decolua/9router>
- Pinned commit: `79918c7830695bbca4a45c9fea4a42c3e9fd73d1`
- License: MIT
- Preserved license text: `upstream/router-core/LICENSE`

The original copyright and permission notice apply to that component. Proxy-Max
changes and integration code remain covered by Proxy-Max's own license unless a
file states otherwise.
