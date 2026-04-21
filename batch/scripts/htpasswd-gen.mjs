#!/usr/bin/env node
// Generate .htpasswd for the admin index using SHA1 (Apache-compatible).
// Reads username/password from stdin prompts (or ADMIN_USER/ADMIN_PASS env vars).
// Writes to dist/{parentHash}/.htpasswd so rsync deploy picks it up.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = (...p) => resolve(here, '..', ...p);

const config = JSON.parse(readFileSync(cwd('config.json'), 'utf8'));
if (!config.parentHash || config.parentHash === 'TBD') {
  console.error('ERROR: parentHash not set. Run: npm run init-hash');
  process.exit(1);
}

const distPath = cwd('dist', config.parentHash);
const adminDir = resolve(distPath, '_admin');
if (!existsSync(adminDir)) {
  console.error(`ERROR: ${adminDir} does not exist. Run: npm run build`);
  process.exit(1);
}

async function prompt(question, { mask = false } = {}) {
  if (mask) {
    // Simple masked-ish: use readline raw mode for password
    process.stdout.write(question);
    return new Promise((resolve) => {
      let buf = '';
      const onData = (d) => {
        const c = d.toString('utf8');
        if (c === '\n' || c === '\r' || c === '\r\n') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (c === '') process.exit(130);
        if (c === '' || c === '\b') { buf = buf.slice(0, -1); process.stdout.write('\b \b'); return; }
        buf += c;
        process.stdout.write('*');
      };
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    });
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

const user = process.env.ADMIN_USER || await prompt('Admin username [admin]: ') || 'admin';
const pass = process.env.ADMIN_PASS || await prompt('Admin password: ', { mask: true });

if (!pass || pass.length < 6) {
  console.error('ERROR: password must be at least 6 characters');
  process.exit(1);
}

// Apache SHA1 format: {SHA}<base64(sha1(password))>
const sha1Hash = '{SHA}' + createHash('sha1').update(pass).digest('base64');
const line = `${user}:${sha1Hash}\n`;
writeFileSync(resolve(adminDir, '.htpasswd'), line, { mode: 0o644 });

console.log(`\nWrote ${adminDir}/.htpasswd`);
console.log(`User: ${user}`);
console.log(`Save the password somewhere safe (1Password, etc.) — it is not stored anywhere else.`);
console.log(`\nAfter deploy:`);
console.log(`  Admin URL:   https://demo.getlineapp.com/${config.parentHash}/_admin/`);
console.log(`  Per-festival demos are NOT protected (intentional).`);
