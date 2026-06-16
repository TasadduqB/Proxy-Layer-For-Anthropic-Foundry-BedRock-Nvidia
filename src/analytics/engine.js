/**
 * Analytics Engine - Session tracking, lifetime metrics, recommendations
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class AnalyticsEngine {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(process.env.HOME || process.env.USERPROFILE, '.proxy-max', 'analytics.db');
    this.db = null;
    this.sessionId = null;
    this.sessionStartTime = null;
    this.initDB();
  }

  /**
   * Initialize SQLite database with schema
   */
  initDB() {
    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) console.error('DB init error:', err);
      else console.log('Analytics DB ready at', this.dbPath);
    });

    // Create tables
    this.db.serialize(() => {
      // Request logs
      this.db.run(`
        CREATE TABLE IF NOT EXISTS request_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          timestamp INTEGER,
          provider TEXT,
          model TEXT,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cached_tokens INTEGER,
          cost_nano_usd INTEGER,
          compression_mode TEXT,
          original_token_count INTEGER,
          compressed_token_count INTEGER,
          response_time_ms INTEGER,
          status TEXT,
          upstream TEXT
        )
      `);

      // Session summary
      this.db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          start_time INTEGER,
          end_time INTEGER,
          total_requests INTEGER,
          total_input_tokens INTEGER,
          total_output_tokens INTEGER,
          total_cost_nano_usd INTEGER,
          total_tokens_saved INTEGER,
          compression_enabled BOOLEAN,
          DEFAULT_MODE TEXT
        )
      `);

      // Command optimization opportunities
      this.db.run(`
        CREATE TABLE IF NOT EXISTS optimization_opportunities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          command TEXT,
          current_output_tokens INTEGER,
          estimated_reduced_tokens INTEGER,
          savings_pct REAL,
          suggested_filter TEXT,
          timestamp INTEGER
        )
      `);

      // Create indexes
      this.db.run('CREATE INDEX IF NOT EXISTS idx_session_timestamp ON request_logs(session_id, timestamp)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_provider ON request_logs(provider)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_model ON request_logs(model)');
    });
  }

  /**
   * Start new session
   */
  startSession(sessionId = null) {
    this.sessionId = sessionId || `session_${Date.now()}`;
    this.sessionStartTime = Date.now();
    
    this.db.run(
      'INSERT INTO sessions (id, start_time, total_requests, total_input_tokens, total_output_tokens, total_cost_nano_usd, total_tokens_saved, compression_enabled) VALUES (?, ?, 0, 0, 0, 0, 0, 1)',
      [this.sessionId, this.sessionStartTime]
    );

    return this.sessionId;
  }

  /**
   * Log individual request
   */
  logRequest(data) {
    const {
      provider,
      model,
      inputTokens = 0,
      outputTokens = 0,
      cachedTokens = 0,
      costNanoUsd = 0,
      compressionMode = 'none',
      originalTokenCount = null,
      compressedTokenCount = null,
      responseTimeMs = 0,
      status = 'success',
      upstream = null,
    } = data;

    const originalCount = originalTokenCount || inputTokens + outputTokens;
    const compressedCount = compressedTokenCount || inputTokens + outputTokens;
    const tokensSaved = originalCount - compressedCount;

    this.db.run(
      `INSERT INTO request_logs 
       (session_id, timestamp, provider, model, input_tokens, output_tokens, cached_tokens, cost_nano_usd, 
        compression_mode, original_token_count, compressed_token_count, response_time_ms, status, upstream)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.sessionId,
        Date.now(),
        provider,
        model,
        inputTokens,
        outputTokens,
        cachedTokens,
        costNanoUsd,
        compressionMode,
        originalCount,
        compressedCount,
        responseTimeMs,
        status,
        upstream,
      ]
    );

    // Update session totals
    this.db.run(
      `UPDATE sessions SET total_requests = total_requests + 1,
       total_input_tokens = total_input_tokens + ?,
       total_output_tokens = total_output_tokens + ?,
       total_cost_nano_usd = total_cost_nano_usd + ?,
       total_tokens_saved = total_tokens_saved + ?
       WHERE id = ?`,
      [inputTokens, outputTokens, costNanoUsd, tokensSaved, this.sessionId]
    );
  }

  /**
   * Record optimization opportunity
   */
  logOpportunity(command, currentTokens, estimatedReduced, suggestedFilter = null) {
    const savingsPct = ((currentTokens - estimatedReduced) / currentTokens) * 100;

    this.db.run(
      `INSERT INTO optimization_opportunities 
       (session_id, command, current_output_tokens, estimated_reduced_tokens, savings_pct, suggested_filter, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [this.sessionId, command, currentTokens, estimatedReduced, savingsPct, suggestedFilter, Date.now()]
    );
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId = null) {
    return new Promise((resolve, reject) => {
      const sid = sessionId || this.sessionId;
      
      this.db.get(
        'SELECT * FROM sessions WHERE id = ?',
        [sid],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || {});
        }
      );
    });
  }

  /**
   * Get request history for session
   */
  getRequestHistory(sessionId = null, limit = 100) {
    return new Promise((resolve, reject) => {
      const sid = sessionId || this.sessionId;

      this.db.all(
        `SELECT * FROM request_logs WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`,
        [sid, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get provider breakdown
   */
  getProviderBreakdown(sessionId = null) {
    return new Promise((resolve, reject) => {
      const sid = sessionId || this.sessionId;

      this.db.all(
        `SELECT provider, 
                COUNT(*) as request_count,
                SUM(input_tokens) as total_input,
                SUM(output_tokens) as total_output,
                SUM(cost_nano_usd) as total_cost_nano
         FROM request_logs
         WHERE session_id = ?
         GROUP BY provider
         ORDER BY total_cost_nano DESC`,
        [sid],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get model breakdown
   */
  getModelBreakdown(sessionId = null) {
    return new Promise((resolve, reject) => {
      const sid = sessionId || this.sessionId;

      this.db.all(
        `SELECT model,
                COUNT(*) as request_count,
                SUM(input_tokens) as total_input,
                SUM(output_tokens) as total_output,
                SUM(cost_nano_usd) as total_cost_nano,
                SUM(compressed_token_count - original_token_count) as tokens_saved
         FROM request_logs
         WHERE session_id = ?
         GROUP BY model
         ORDER BY total_cost_nano DESC`,
        [sid],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get compression impact
   */
  getCompressionStats(sessionId = null) {
    return new Promise((resolve, reject) => {
      const sid = sessionId || this.sessionId;

      this.db.all(
        `SELECT compression_mode,
                COUNT(*) as request_count,
                SUM(original_token_count) as original_tokens,
                SUM(compressed_token_count) as compressed_tokens,
                SUM(original_token_count - compressed_token_count) as tokens_saved
         FROM request_logs
         WHERE session_id = ?
         GROUP BY compression_mode
         ORDER BY tokens_saved DESC`,
        [sid],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get lifetime statistics across all sessions
   */
  getLifetimeStats() {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT 
                COUNT(DISTINCT id) as total_sessions,
                SUM(total_requests) as total_requests,
                SUM(total_input_tokens) as total_input_tokens,
                SUM(total_output_tokens) as total_output_tokens,
                SUM(total_cost_nano_usd) as total_cost_nano_usd,
                SUM(total_tokens_saved) as total_tokens_saved
         FROM sessions`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row || {});
        }
      );
    });
  }

  /**
   * Get top optimization opportunities
   */
  getOptimizationOpportunities(limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM optimization_opportunities
         ORDER BY savings_pct DESC
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * End session
   */
  endSession(sessionId = null) {
    const sid = sessionId || this.sessionId;
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE sessions SET end_time = ? WHERE id = ?',
        [Date.now(), sid],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Close database connection
   */
  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

module.exports = AnalyticsEngine;
