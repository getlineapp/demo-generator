#!/usr/bin/env node
// Idempotent generator: writes a 12-char hex `parentHash` to config.json.
// Re-running does nothing (so URLs stay stable after deploy).

import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(here, '..', 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

if (config.parentHash && config.parentHash !== 'TBD') {
  console.log('parentHash already set:', config.parentHash);
  process.exit(0);
}

config.parentHash = randomBytes(6).toString('hex');
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('Generated parentHash:', config.parentHash);
console.log('Demo URLs will be served at:');
console.log(`  https://demo.getlineapp.com/${config.parentHash}/{festival-slug}/`);
