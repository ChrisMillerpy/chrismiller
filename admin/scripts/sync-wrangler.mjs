#!/usr/bin/env node
// Copies Terraform's outputs for one environment into wrangler.jsonc, keeping its comments.
//
//   terraform -chdir=../infra/envs/prod output -json wrangler | node scripts/sync-wrangler.mjs
//   terraform -chdir=../infra/envs/staging output -json wrangler | node scripts/sync-wrangler.mjs
//   node scripts/sync-wrangler.mjs --check prod     (CI runs this before deploying)
//
// None of these values are secret: the AUD tag and team domain are in every Access token.

import { readFileSync, writeFileSync } from 'node:fs';
import { applyEdits, modify, parse } from 'jsonc-parser';

const ENVS = { prod: [], staging: ['env', 'staging'] };
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

export function applyOutputs(text, outputs) {
  const base = ENVS[outputs.env];
  if (!base) throw new Error(`Unknown env "${outputs.env}"; expected prod or staging.`);
  for (const key of ['access_team_domain', 'access_aud', 'hyperdrive_id']) {
    if (!outputs[key]) throw new Error(`Missing ${key} in the Terraform outputs.`);
  }
  const set = (path, value) => {
    text = applyEdits(text, modify(text, [...base, ...path], value, FORMAT));
  };
  set(['vars', 'ACCESS_TEAM_DOMAIN'], outputs.access_team_domain);
  set(['vars', 'ACCESS_AUD'], outputs.access_aud);
  set(['hyperdrive', 0, 'id'], outputs.hyperdrive_id);
  return text;
}

/** What's still unset for an environment. Deploys refuse to run until this is empty. */
export function missingConfig(text, env) {
  const base = ENVS[env];
  if (!base) throw new Error(`Unknown env "${env}"; expected prod or staging.`);
  let c = parse(text);
  for (const key of base) c = c?.[key];
  const missing = [];
  if (!c?.vars?.ACCESS_TEAM_DOMAIN) missing.push('ACCESS_TEAM_DOMAIN');
  if (!c?.vars?.ACCESS_AUD) missing.push('ACCESS_AUD');
  if (!c?.hyperdrive?.[0]?.id || /^0+$/.test(c.hyperdrive[0].id)) missing.push('hyperdrive id');
  return missing;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = new URL('../wrangler.jsonc', import.meta.url);
  // `node scripts/sync-wrangler.mjs --check prod`: exit 1 if that environment isn't configured.
  if (process.argv[2] === '--check') {
    const missing = missingConfig(readFileSync(file, 'utf8'), process.argv[3]);
    if (missing.length) {
      console.error(`wrangler.jsonc is not configured for ${process.argv[3]}: ${missing.join(', ')} unset. Run the Terraform sync first (infra/README.md).`);
      process.exit(1);
    }
    console.log(`wrangler.jsonc is configured for ${process.argv[3]}.`);
    process.exit(0);
  }
  const outputs = JSON.parse(readFileSync(0, 'utf8'));
  writeFileSync(file, applyOutputs(readFileSync(file, 'utf8'), outputs));
  console.log(`wrangler.jsonc updated for ${outputs.env}.`);
}
