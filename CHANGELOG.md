# Changelog

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
