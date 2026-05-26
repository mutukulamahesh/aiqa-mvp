#!/usr/bin/env node
// In production (Docker, shell installer): dist/cli.js is pre-built — use it directly.
// In development (local clone with devDeps): fall back to ts-node for live transpilation.
const path = require('path');
const fs   = require('fs');
const dist = path.join(__dirname, '../dist/cli.js');
if (fs.existsSync(dist)) {
  require(dist);
} else {
  require('ts-node').register({ transpileOnly: true });
  require('../src/cli');
}
