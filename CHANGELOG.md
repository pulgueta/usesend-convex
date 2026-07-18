# Changelog

## Unreleased

- **Security** (#4): stop persisting the raw useSend API key in durable
  `emails` documents. The component now declares a `USESEND_API_KEY`
  environment variable and resolves the credential at send time from
  deployment secret storage.
- **Breaking**: the component now declares every env var it can use
  (`USESEND_API_KEY`, required; `USESEND_BASE_URL`, optional), and apps must
  bind them when installing it in `convex/convex.config.ts`:

  ```ts
  const app = defineApp({
    env: {
      USESEND_API_KEY: v.string(),
      USESEND_BASE_URL: v.optional(v.string()),
    },
  });
  app.use(usesend, {
    env: {
      USESEND_API_KEY: app.env.USESEND_API_KEY,
      USESEND_BASE_URL: app.env.USESEND_BASE_URL,
    },
  });
  ```

  A bound `USESEND_BASE_URL` takes precedence over the client-provided
  `baseUrl` for durable batch sends. (`USESEND_WEBHOOK_SECRET` remains
  app-side: webhook verification runs in the app's HTTP action.)

  The `apiKey` client option is now app-side only (direct REST client, manual
  sends, and a preflight check) and is no longer forwarded to the component.

- Deployments upgrading with retained emails from `<= 0.1.1` keep passing
  schema validation (the legacy stored field is tolerated but never written).
  Run the new `lib.scrubApiKeys` component mutation once to strip previously
  persisted keys from old rows.

## 0.1.1

- Encode REST resource IDs before building request paths.
- Restrict public example functions to a configured admin identity and avoid
  logging bounce payloads.
- Preserve `cc` and `bcc` recipients for tracked manual sends.
- Keep request timeouts active through response body reads and recover batch
  scheduling when workpool enqueueing fails.
- Keep raw API keys out of serialized batching cache keys.

## 0.1.0

- Initial useSend Convex component release with durable batching, retries,
  webhook tracking, a typed REST client, and React Email support.
