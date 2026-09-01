'use strict';

/**
 * Adaptive circuit breaker — adapted from OmniRoute
 * (https://github.com/diegosouzapw/OmniRoute, MIT License, Copyright (c) 2026 diegosouzapw).
 * See THIRD_PARTY_NOTICES.md.
 *
 * Ported from src/shared/utils/circuitBreaker.ts, with DB persistence removed
 * (in-memory only — Proxy-Max's own pool stats already carry cooldown state
 * across requests within a process; nothing here required a database).
 *
 * States: CLOSED → DEGRADED → OPEN → HALF_OPEN → CLOSED
 *   CLOSED    — normal operation
 *   DEGRADED  — elevated failure rate; requests still pass through, just logged
 *   OPEN      — requests are short-circuited until the cooldown elapses
 *   HALF_OPEN — cooldown elapsed; a limited number of probe requests are let
 *               through to test whether the upstream has recovered
 *
 * Key upgrade over a flat cooldown: each OPEN → HALF_OPEN → OPEN cycle (i.e.
 * every time a probe fails) escalates the reset timeout exponentially, up to
 * `maxBackoffMultiplier`x the base `resetTimeout`. A provider that is
 * consistently down gets backed off harder over time instead of being
 * re-probed at the same fixed interval forever.
 *
 * This module is standalone: it does not know about Proxy-Max's pool stats
 * or config. server.js wires it in as an *additional*, opt-in signal — see
 * POOL_BREAKER.adaptive in server.js — so existing flat-cooldown behavior is
 * unchanged unless explicitly enabled.
 */

const STATE = { CLOSED: 'CLOSED', DEGRADED: 'DEGRADED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

class CircuitBreakerOpenError extends Error {
  constructor(message, circuitName, retryAfterMs) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.circuitName = circuitName;
    this.retryAfterMs = retryAfterMs;
  }
}

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000;
    this.halfOpenRequests = options.halfOpenRequests ?? 1;
    this.onStateChange = options.onStateChange || null;
    this.isFailure = options.isFailure || (() => true);
    this.cooldownByKind = options.cooldownByKind ?? {};
    this.classifyError = options.classifyError ?? null;
    this.kindThresholds = options.kindThresholds ?? {};
    this.degradationThreshold = options.degradationThreshold ?? Math.ceil((this.failureThreshold * 60) / 100);
    this.maxBackoffMultiplier = options.maxBackoffMultiplier ?? 16;
    this.backoffEscalationCount = options.backoffEscalationCount ?? 3;

    this.state = STATE.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.halfOpenAllowed = 0;
    this.lastFailureKind = null;
    this.kindFailureCounts = {};
    this.openCycleCount = 0;
    this.transitionHistory = [];
    this.maxTransitionHistory = 20;
  }

  _effectiveResetTimeout() {
    if (this.openCycleCount <= this.backoffEscalationCount) return this.resetTimeout;
    const escalationFactor = Math.pow(2, this.openCycleCount - this.backoffEscalationCount);
    return Math.min(this.resetTimeout * escalationFactor, this.resetTimeout * this.maxBackoffMultiplier);
  }

  async execute(fn) {
    this._refreshOpenState();
    if (this.state === STATE.OPEN) {
      throw new CircuitBreakerOpenError(`Circuit breaker "${this.name}" is OPEN. Try again later.`, this.name, this._timeUntilReset());
    }
    if (this.state === STATE.HALF_OPEN && this.halfOpenAllowed <= 0) {
      throw new CircuitBreakerOpenError(`Circuit breaker "${this.name}" is HALF_OPEN, no more probe requests allowed.`, this.name, this._timeUntilReset());
    }
    if (this.state === STATE.HALF_OPEN) this.halfOpenAllowed--;

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      if (this.isFailure(error)) {
        let kind;
        try { kind = this.classifyError ? this.classifyError(error) : undefined; } catch { kind = undefined; }
        this._onFailure(kind);
      }
      throw error;
    }
  }

  /** Record a failure without wrapping a call — for use in existing try/catch blocks. */
  recordFailure(error) {
    if (!this.isFailure(error)) return;
    let kind;
    try { kind = this.classifyError ? this.classifyError(error) : undefined; } catch { kind = undefined; }
    this._onFailure(kind);
  }

  /** Record a success without wrapping a call. */
  recordSuccess() {
    this._onSuccess();
  }

  canExecute() {
    this._refreshOpenState();
    if (this.state === STATE.CLOSED || this.state === STATE.DEGRADED) return true;
    if (this.state === STATE.OPEN) return false;
    if (this.state === STATE.HALF_OPEN) return this.halfOpenAllowed > 0;
    return false;
  }

  getStatus() {
    this._refreshOpenState();
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      retryAfterMs: this.getRetryAfterMs(),
      lastFailureKind: this.lastFailureKind,
      openCycleCount: this.openCycleCount,
      kindFailureCounts: { ...this.kindFailureCounts },
      degradationThreshold: this.degradationThreshold,
      effectiveResetTimeout: this._effectiveResetTimeout(),
      transitionHistory: [...this.transitionHistory],
    };
  }

  getRetryAfterMs() {
    this._refreshOpenState();
    if (this.state === STATE.CLOSED || this.state === STATE.DEGRADED) return 0;
    return this._timeUntilReset();
  }

  reset() {
    this._transition(STATE.CLOSED, 'manual-reset');
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastFailureKind = null;
    this.openCycleCount = 0;
    this.kindFailureCounts = {};
  }

  _onSuccess() {
    if (this.state === STATE.OPEN) {
      this._transition(STATE.CLOSED, 'success-recovery');
      this.failureCount = 0; this.successCount = 0; this.lastFailureTime = null;
      this.lastFailureKind = null; this.openCycleCount = 0; this.kindFailureCounts = {};
    } else if (this.state === STATE.HALF_OPEN) {
      this.successCount++;
      this._transition(STATE.CLOSED, 'probe-success');
      this.failureCount = 0; this.lastFailureKind = null; this.openCycleCount = 0; this.kindFailureCounts = {};
    } else {
      this.failureCount = Math.max(0, this.failureCount - 1);
      if (this.state === STATE.DEGRADED && this.failureCount <= this.degradationThreshold) {
        this._transition(STATE.CLOSED, 'recovery');
      }
    }
  }

  _onFailure(kind) {
    const failureKind = kind ?? null;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.lastFailureKind = failureKind;

    if (failureKind) {
      this.kindFailureCounts[failureKind] = (this.kindFailureCounts[failureKind] || 0) + 1;
      const kindConfig = this.kindThresholds[failureKind];
      if (kindConfig) {
        const kindCount = this.kindFailureCounts[failureKind] || 0;
        if (kindConfig.immediateOpen && kindCount >= (kindConfig.threshold || 1)) return this._openCircuit(failureKind);
        if (kindCount >= (kindConfig.threshold || this.failureThreshold)) return this._openCircuit(failureKind);
      }
    }

    if (this.state === STATE.OPEN) {
      // already open
    } else if (this.state === STATE.HALF_OPEN) {
      this.openCycleCount++;
      this._transition(STATE.OPEN, `probe-failed (cycle ${this.openCycleCount})`);
    } else if (this.state === STATE.DEGRADED) {
      if (this.failureCount >= this.failureThreshold) this._openCircuit(failureKind);
    } else {
      if (this.failureCount >= this.failureThreshold) this._openCircuit(failureKind);
      else if (this.failureCount >= this.degradationThreshold) {
        this._transition(STATE.DEGRADED, `elevated-failures (${this.failureCount}/${this.failureThreshold})`);
      }
    }
  }

  _openCircuit(kind) {
    this._transition(STATE.OPEN, kind ? `kind:${kind}` : undefined);
  }

  _shouldAttemptReset() {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime >= this._effectiveCooldown();
  }

  _effectiveCooldown() {
    const baseTimeout = this._effectiveResetTimeout();
    if (this.lastFailureKind !== null) {
      const override = this.cooldownByKind[this.lastFailureKind];
      if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override;
    }
    return baseTimeout;
  }

  _timeUntilReset() {
    if (!this.lastFailureTime) return 0;
    return Math.max(0, this._effectiveCooldown() - (Date.now() - this.lastFailureTime));
  }

  _refreshOpenState() {
    if (this.state === STATE.OPEN && this._shouldAttemptReset()) {
      this._transition(STATE.HALF_OPEN, 'timeout-elapsed');
    }
  }

  _transition(newState, reason) {
    const oldState = this.state;
    this.state = newState;
    if (newState === STATE.HALF_OPEN) this.halfOpenAllowed = this.halfOpenRequests;
    this.transitionHistory.push({ from: oldState, to: newState, timestamp: Date.now(), failureCount: this.failureCount, reason });
    if (this.transitionHistory.length > this.maxTransitionHistory) this.transitionHistory.shift();
    if (this.onStateChange && oldState !== newState) this.onStateChange(this.name, oldState, newState);
  }
}

// ─── Registry ───────────────────────────────────────────────────────────

const MAX_REGISTRY_SIZE = 500;
const registry = new Map();

function evictColdBreakersIfNeeded() {
  if (registry.size < MAX_REGISTRY_SIZE) return;
  const candidates = [];
  for (const [name, breaker] of registry) {
    const status = breaker.getStatus();
    if (status.state === STATE.CLOSED && status.failureCount === 0) {
      candidates.push({ name, lastFailureTime: status.lastFailureTime || 0 });
    }
  }
  candidates.sort((a, b) => a.lastFailureTime - b.lastFailureTime);
  const target = registry.size - MAX_REGISTRY_SIZE + 1;
  for (let i = 0; i < candidates.length && i < target; i++) registry.delete(candidates[i].name);
}

function getCircuitBreaker(name, options) {
  if (!registry.has(name)) {
    evictColdBreakersIfNeeded();
    registry.set(name, new CircuitBreaker(name, options));
  }
  return registry.get(name);
}

function getAllCircuitBreakerStatuses() {
  return Array.from(registry.values()).map((cb) => cb.getStatus());
}

function resetAllCircuitBreakers() {
  for (const cb of registry.values()) cb.reset();
  registry.clear();
}

module.exports = {
  STATE,
  CircuitBreaker,
  CircuitBreakerOpenError,
  getCircuitBreaker,
  getAllCircuitBreakerStatuses,
  resetAllCircuitBreakers,
};
