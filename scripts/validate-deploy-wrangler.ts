#!/usr/bin/env tsx
/**
 * Read-only validation of the Wrangler JSON emitted by the Cloudflare build.
 * This check never writes configuration or invents Cloudflare resource IDs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entries(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isPlaceholder(value: string): boolean {
  return /<[^>]+>|YOUR_|PLACEHOLDER|CHANGE_ME|REPLACE_ME/i.test(value);
}

function checkRequiredString(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label} is missing`);
    return;
  }
  if (isPlaceholder(value.trim())) {
    errors.push(`${label} still contains a placeholder value`);
  }
}

/** Return deployment blockers without mutating the supplied config. */
export function validateDeployWranglerConfig(config: UnknownRecord): string[] {
  const errors: string[] = [];

  const databases = entries(config.d1_databases);
  if (databases.length === 0) {
    errors.push('At least one D1 database binding is required');
  }
  databases.forEach((database, index) => {
    checkRequiredString(database.database_id, `d1_databases[${index}].database_id`, errors);
    checkRequiredString(database.database_name, `d1_databases[${index}].database_name`, errors);
  });

  const buckets = entries(config.r2_buckets);
  if (buckets.length === 0) {
    errors.push('At least one R2 bucket binding is required');
  }
  buckets.forEach((bucket, index) => {
    checkRequiredString(bucket.bucket_name, `r2_buckets[${index}].bucket_name`, errors);
  });

  // KV is optional in this project. If configured, its ID must be real.
  entries(config.kv_namespaces).forEach((namespace, index) => {
    checkRequiredString(namespace.id, `kv_namespaces[${index}].id`, errors);
  });

  const observability = isRecord(config.observability) ? config.observability : {};
  const logs = isRecord(observability.logs) ? observability.logs : {};
  if (logs.persist !== true) {
    errors.push('observability.logs.persist must be true (run the Wrangler patch step)');
  }

  return errors;
}

export function validateDeployWranglerFile(cwd: string): string {
  const configPath = resolve(cwd, 'dist/server/wrangler.json');
  if (!existsSync(configPath)) {
    throw new Error(`Deploy config not found: ${configPath} (run the Cloudflare build first)`);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as UnknownRecord;
  const errors = validateDeployWranglerConfig(config);
  if (errors.length > 0) {
    throw new Error([
      'Cloudflare deployment preflight failed:',
      ...errors.map((error) => `- ${error}`),
      'Set real resource values in wrangler.toml or the TYPECHO_* Cloudflare build variables; no IDs are generated automatically.',
    ].join('\n'));
  }

  return configPath;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return !!entry && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    const path = validateDeployWranglerFile(process.cwd());
    console.log(`Cloudflare deployment config validated: ${path}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
