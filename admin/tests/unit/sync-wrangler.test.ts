import { readFileSync } from 'node:fs';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { applyOutputs } from '../../scripts/sync-wrangler.mjs';

// The real wrangler.jsonc, with every environment's Terraform values blanked, so these tests
// don't depend on which environments have been set up.
function blank(text: string) {
  for (const base of [[], ['env', 'staging']]) {
    for (const [path, value] of [
      [['vars', 'ACCESS_TEAM_DOMAIN'], ''],
      [['vars', 'ACCESS_AUD'], ''],
      [['hyperdrive', 0, 'id'], '00000000000000000000000000000000'],
    ] as const) {
      text = applyEdits(text, modify(text, [...base, ...path], value, {}));
    }
  }
  return text;
}
const config = blank(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
const outputs = (env: string) => ({
  env,
  access_team_domain: `https://withchris.cloudflareaccess.com`,
  access_aud: `aud-${env}`,
  hyperdrive_id: `hd-${env}`,
});

describe('applyOutputs', () => {
  it('writes production values at the top level', () => {
    const c = parse(applyOutputs(config, outputs('prod')));
    expect(c.vars).toEqual({ ACCESS_TEAM_DOMAIN: 'https://withchris.cloudflareaccess.com', ACCESS_AUD: 'aud-prod' });
    expect(c.hyperdrive).toEqual([{ binding: 'HYPERDRIVE', id: 'hd-prod' }]);
    expect(c.env.staging.vars.ACCESS_AUD).toBe('');
  });

  it('writes staging values under env.staging', () => {
    const c = parse(applyOutputs(config, outputs('staging')));
    expect(c.env.staging.vars.ACCESS_AUD).toBe('aud-staging');
    expect(c.env.staging.hyperdrive[0].id).toBe('hd-staging');
    expect(c.vars.ACCESS_AUD).toBe('');
  });

  it('keeps the comments', () => {
    expect(applyOutputs(config, outputs('prod'))).toContain('// The custom domain behind Access must be the only way in.');
  });

  it('is idempotent', () => {
    const once = applyOutputs(config, outputs('prod'));
    expect(applyOutputs(once, outputs('prod'))).toBe(once);
  });

  it('refuses unknown environments and missing values', () => {
    expect(() => applyOutputs(config, outputs('dev'))).toThrow(/env/);
    expect(() => applyOutputs(config, { ...outputs('prod'), access_aud: '' })).toThrow(/access_aud/);
  });
});

import { missingConfig } from '../../scripts/sync-wrangler.mjs';

describe('missingConfig', () => {
  it('lists what is still a placeholder', () => {
    expect(missingConfig(config, 'prod')).toEqual(['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'hyperdrive id']);
  });

  it('is empty once Terraform outputs are applied', () => {
    expect(missingConfig(applyOutputs(config, outputs('staging')), 'staging')).toEqual([]);
    expect(missingConfig(applyOutputs(config, outputs('staging')), 'prod')).toHaveLength(3);
  });
});
