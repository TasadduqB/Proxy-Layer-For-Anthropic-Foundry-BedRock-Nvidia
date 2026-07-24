'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function deriveCliToken(dataDir) {
  const raw = fs.readFileSync(path.join(dataDir, 'machine-id'), 'utf8').trim();
  const secret = fs.readFileSync(path.join(dataDir, 'auth', 'cli-secret'), 'utf8').trim();
  return crypto.createHash('sha256').update(`${raw}9r-cli-auth${secret}`).digest('hex').slice(0, 16);
}

module.exports = { deriveCliToken };
