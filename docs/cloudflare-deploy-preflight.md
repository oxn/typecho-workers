# Cloudflare deployment preflight

The existing deployment commands are unchanged. These are opt-in alternatives
that validate the generated Wrangler deployment configuration before invoking
Wrangler.

## Commands

For a complete Cloudflare build, validation, and deployment:

```sh
bun run deploy:checked
```

If Cloudflare Workers Builds runs the build separately, use the existing
`bun run build:cloudflare` build command, followed by:

```sh
bun run deploy:cloudflare-build:checked
```

To run validation without deploying:

```sh
bun run deploy:preflight
```

## What is checked

The read-only preflight validates `dist/server/wrangler.json` and requires:

- At least one D1 binding with a non-empty database name and real database ID.
- At least one R2 binding with a non-empty bucket name.
- A real ID for every configured KV namespace. KV itself remains optional.
- `observability.logs.persist = true`, consistent with the existing metrics setup.

The validator does not write configuration, create Cloudflare resources, or
invent resource IDs. If a placeholder is found, it stops before Wrangler deploy.

For generated Cloudflare Build configuration, provide the existing
`TYPECHO_D1_DATABASE_ID`, `TYPECHO_D1_DATABASE_NAME`, and
`TYPECHO_R2_BUCKET_NAME` variables. Configure
`TYPECHO_KV_NAMESPACE_ID` only when the optional KV binding is used.

No deployment is performed by the validator or by CI checks for this change.
