// NVIDIA Build model catalog sync.
// Pulls the live model list from integrate.api.nvidia.com/v1/models when an API
// key is configured, then reshapes it into the UI's grouped catalog format.

const LIVE_MODELS_URL = 'https://integrate.api.nvidia.com/v1/models';
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache = {
  expiresAt: 0,
  groups: null,
  pending: null,
};

function titleCaseSlug(slug) {
  return String(slug || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => {
      if (/^\d/.test(part)) return part;
      if (part.length <= 3) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ')
    .trim();
}

function makeLabel(id) {
  const s = String(id || '').trim();
  if (!s) return 'Unknown model';
  const slash = s.indexOf('/');
  const name = slash >= 0 ? s.slice(slash + 1) : s;
  return titleCaseSlug(name) || s;
}

function groupFromId(id) {
  const s = String(id || '');
  const slash = s.indexOf('/');
  const vendor = (slash >= 0 ? s.slice(0, slash) : 'other').trim();
  const nice = titleCaseSlug(vendor) || 'Other';
  return `NVIDIA Build — ${nice}`;
}

function toGroupedCatalog(ids) {
  const byGroup = new Map();
  for (const id of ids) {
    if (!id || typeof id !== 'string') continue;
    const group = groupFromId(id);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push({ id, label: makeLabel(id) });
  }

  const groups = [...byGroup.entries()]
    .map(([group, models]) => ({
      group,
      models: models.sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.group.localeCompare(b.group));

  return groups;
}

async function fetchLiveNvidiaModelGroups(apiKey, { forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.groups && cache.expiresAt > now) return cache.groups;
  if (cache.pending) return cache.pending;
  if (!apiKey) return null;

  cache.pending = (async () => {
    const resp = await fetch(LIVE_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`NVIDIA model sync failed (${resp.status}): ${text.slice(0, 160)}`);
    }

    const json = await resp.json();
    const ids = (json?.data || [])
      .map(m => (m && typeof m.id === 'string' ? m.id.trim() : ''))
      .filter(Boolean);

    if (ids.length === 0) return null;

    const groups = toGroupedCatalog(ids);
    cache.groups = groups;
    cache.expiresAt = Date.now() + CACHE_TTL_MS;
    return groups;
  })();

  try {
    return await cache.pending;
  } finally {
    cache.pending = null;
  }
}

module.exports = {
  fetchLiveNvidiaModelGroups,
};
