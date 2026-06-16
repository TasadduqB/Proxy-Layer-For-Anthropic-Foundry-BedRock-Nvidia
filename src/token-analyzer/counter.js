/**
 * Token Counter - 3-tier estimation strategy
 * Tier 1: OpenAI BPE (tiktoken exact)
 * Tier 2: Heuristic character classification (provider-specific multipliers)
 * Tier 3: Fallback (upstream reported or 4 chars per token)
 */

const { encoding_for_model, get_encoding } = require('js-tiktoken');

class TokenCounter {
  constructor() {
    this.encEncodings = {
      o: get_encoding('o200k_base'), // o1, o3, gpt-4o models
      cl100k: get_encoding('cl100k_base'), // Most other models
    };
    
    // Provider-specific character multipliers (empirical analysis)
    this.multipliers = {
      openai: { words: 1.02, numbers: 1.55, cjk: 0.85, symbols: 0.4, math_symbols: 2.68, emoji: 2.12 },
      gemini: { words: 1.15, numbers: 2.8, cjk: 0.68, symbols: 0.38, math_symbols: 1.05, emoji: 1.08 },
      anthropic: { words: 1.13, numbers: 1.63, cjk: 1.21, symbols: 0.4, math_symbols: 4.52, emoji: 2.6 },
    };

    this.charRanges = {
      cjk: [
        [0x3040, 0x309F], // Hiragana
        [0x30A0, 0x30FF], // Katakana
        [0x4E00, 0x9FFF], // Han
        [0xAC00, 0xD7A3], // Hangul
      ],
      mathSymbols: [
        [0x2200, 0x22FF], // Mathematical operators
        [0x2A00, 0x2AFF], // Supplemental math operators
        [0x1D400, 0x1D7FF], // Mathematical alphanumeric symbols
      ],
      emoji: [
        [0x1F300, 0x1F9FF], // Emoji ranges
      ],
    };
  }

  /**
   * Estimate tokens using 3-tier strategy
   */
  estimateTokens(text, options = {}) {
    const { provider = 'openai', model = 'gpt-4o', tier1Only = false } = options;

    // Tier 1: Exact BPE (if < 128KB)
    if (text.length < 128 * 1024) {
      try {
        return this.tier1_exactBPE(text, model);
      } catch (err) {
        if (tier1Only) throw err;
      }
    }

    // Tier 2: Heuristic character classification
    return this.tier2_characterHeuristic(text, provider);
  }

  /**
   * Tier 1: Exact BPE encoding
   */
  tier1_exactBPE(text, model) {
    const isO = model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4');
    const encoding = isO ? this.encEncodings.o : this.encEncodings.cl100k;
    
    const tokens = encoding.encode(text);
    return tokens.length;
  }

  /**
   * Tier 2: Character-class heuristics
   */
  tier2_characterHeuristic(text, provider = 'openai') {
    const mults = this.multipliers[provider] || this.multipliers.openai;
    let tokenCount = 0;

    let i = 0;
    while (i < text.length) {
      const charCode = text.charCodeAt(i);

      // CJK
      if (this.isInRange(charCode, this.charRanges.cjk)) {
        tokenCount += 1.0 * mults.cjk;
        i++;
      }
      // Emoji
      else if (this.isInRange(charCode, this.charRanges.emoji)) {
        tokenCount += 1.0 * mults.emoji;
        i += 2; // Emoji are often 2+ chars
      }
      // Math symbols
      else if (this.isInRange(charCode, this.charRanges.mathSymbols)) {
        tokenCount += 1.0 * mults.math_symbols;
        i++;
      }
      // URL delimiters
      else if ('/:?&=;#%'.includes(text[i])) {
        tokenCount += 1.0 * mults.symbols;
        i++;
      }
      // Numbers
      else if (/\d/.test(text[i])) {
        tokenCount += 1.0 * mults.numbers;
        i++;
      }
      // Words (alphabetic)
      else if (/[a-zA-Z]/.test(text[i])) {
        // Consume whole word
        let word = '';
        while (i < text.length && /[a-zA-Z]/.test(text[i])) {
          word += text[i];
          i++;
        }
        tokenCount += word.length * mults.words;
      }
      // Whitespace/other symbols
      else {
        tokenCount += 1.0 * mults.symbols;
        i++;
      }
    }

    return Math.ceil(tokenCount);
  }

  /**
   * Check if char code is in any range
   */
  isInRange(charCode, ranges) {
    return ranges.some(([min, max]) => charCode >= min && charCode <= max);
  }

  /**
   * Count tokens in structured content (messages, tools, etc.)
   */
  countStructuredContent(content, provider = 'openai') {
    let total = 0;

    if (typeof content === 'string') {
      total += this.estimateTokens(content, { provider });
    } else if (Array.isArray(content)) {
      // Array of messages or blocks
      content.forEach(item => {
        if (item.content) {
          total += this.countStructuredContent(item.content, provider);
        } else if (item.text) {
          total += this.estimateTokens(item.text, { provider });
        } else if (typeof item === 'string') {
          total += this.estimateTokens(item, { provider });
        }
      });
    } else if (typeof content === 'object') {
      // Recursively count all string values
      Object.values(content).forEach(val => {
        if (typeof val === 'string') {
          total += this.estimateTokens(val, { provider });
        } else if (typeof val === 'object') {
          total += this.countStructuredContent(val, provider);
        }
      });
    }

    return total;
  }

  /**
   * Calculate actual usage from upstream response
   */
  parseUpstreamUsage(response, provider = 'openai') {
    const result = {
      input_tokens: 0,
      output_tokens: 0,
      cached_tokens: 0,
      total_tokens: 0,
    };

    if (!response) return result;

    switch (provider.toLowerCase()) {
      case 'openai':
      case 'openai-response':
        result.input_tokens = response.usage?.prompt_tokens || 0;
        result.output_tokens = response.usage?.completion_tokens || 0;
        result.cached_tokens = response.usage?.prompt_tokens_details?.cache_read_input_tokens || 0;
        break;

      case 'anthropic':
        result.input_tokens = response.usage?.input_tokens || 0;
        result.output_tokens = response.usage?.output_tokens || 0;
        result.cached_tokens = response.usage?.cache_read_input_tokens || 0;
        break;

      case 'gemini':
        result.input_tokens = response.usageMetadata?.promptTokenCount || 0;
        result.output_tokens = response.usageMetadata?.candidatesTokenCount || 0;
        result.cached_tokens = response.usageMetadata?.cachedContentTokenCount || 0;
        break;
    }

    result.total_tokens = result.input_tokens + result.output_tokens;
    return result;
  }
}

module.exports = TokenCounter;
