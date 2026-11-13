import { describe, expect, it } from 'vitest';
import { validateDeployWranglerConfig } from '../scripts/validate-deploy-wrangler';

const validConfig = {
  d1_databases: [{ binding: 'DB', database_name: 'typecho-db', database_id: '0123456789abcdef0123456789abcdef' }],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: 'typecho-uploads' }],
  observability: { logs: { persist: true } },
};

describe('validateDeployWranglerConfig', () => {
  it('accepts real D1/R2 values when optional KV is absent', () => {
    expect(validateDeployWranglerConfig(validConfig)).toEqual([]);
  });

  it('rejects example placeholder IDs instead of allowing a doomed deploy', () => {
    const config = {
      ...validConfig,
      d1_databases: [{ database_name: 'typecho-db', database_id: '<YOUR_D1_DATABASE_ID>' }],
      kv_namespaces: [{ id: '<YOUR_KV_NAMESPACE_ID>' }],
    };

    expect(validateDeployWranglerConfig(config)).toEqual([
      'd1_databases[0].database_id still contains a placeholder value',
      'kv_namespaces[0].id still contains a placeholder value',
    ]);
  });

  it('requires at least one D1 database and R2 bucket', () => {
    expect(validateDeployWranglerConfig({
      observability: { logs: { persist: true } },
    })).toEqual([
      'At least one D1 database binding is required',
      'At least one R2 bucket binding is required',
    ]);
  });

  it('requires persisted Workers logs for the existing metrics setup', () => {
    expect(validateDeployWranglerConfig({
      ...validConfig,
      observability: { logs: { persist: false } },
    })).toContain('observability.logs.persist must be true (run the Wrangler patch step)');
  });
});
