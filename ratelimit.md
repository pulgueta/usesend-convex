# Rate Limiter

- [get-convex/rate-limiter](https://github.com/get-convex/rate-limiter) — Convex component for application-level rate limiting
- [View package](https://www.npmjs.com/package/@convex-dev/rate-limiter)

```bash
npm install @convex-dev/rate-limiter
```

This component provides application-level rate limiting.

## Teaser

```ts
const rateLimiter = new RateLimiter(components.rateLimiter, {
  freeTrialSignUp: { kind: "fixed window", rate: 100, period: HOUR },
  sendMessage: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },
});

// Restrict how fast free users can sign up to deter bots
const status = await rateLimiter.limit(ctx, "freeTrialSignUp");

// Limit how fast a user can send messages
const status = await rateLimiter.limit(ctx, "sendMessage", { key: userId });

// Use the React hook to check the rate limit
const { status, check } = useRateLimit(api.example.getRateLimit, { count });
```

---

## What is rate limiting?

Rate limiting is the technique of controlling how often actions can be performed, typically on a server. There are many options for achieving this, most of which operate at the network layer.

## What is application-layer rate limiting?

Application-layer rate limiting happens in your app's code where you handle authentication, authorization, and other business logic. It allows nuanced rules and fairer policy enforcement. It is not the first line of defense for sophisticated DDoS attacks (which are extremely rare), but will serve most real-world use cases.

## What differentiates this approach?

- **Type-safe usage**: You won't accidentally misspell a rate limit name.
- **Configurable**: Fixed window or token bucket algorithms.
- **Efficient storage and compute**: Storage is not proportional to requests.
- **Configurable sharding** for scalability.
- **Transactional evaluation**: All rate limit changes roll back if your mutation fails.
- **Fairness guarantees** via credit "reservation": avoid exponential backoff.
- **Opt-in "rollover" or "burst" allowance** via configurable `capacity`.
- **Fails closed, not open**: Avoid cascading failure when traffic overwhelms rate limits.

See the associated Stack post for more details and background.

---

## Pre-requisite: Convex

You'll need an existing Convex project. Convex is a hosted backend platform, including a database, serverless functions, and more.

Run `npm create convex` or follow any of the quickstarts to set one up.

## Installation

Install the component package:

```bash
npm install @convex-dev/rate-limiter
```

Create a `convex.config.ts` file in your app's `convex/` folder and install the component:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
app.use(rateLimiter);

export default app;
```

## Define your rate limits

```ts
import { RateLimiter, MINUTE, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  // One global / singleton rate limit, using a "fixed window" algorithm.
  freeTrialSignUp: { kind: "fixed window", rate: 100, period: HOUR },

  // A per-user limit, allowing one every ~6 seconds.
  // Allows up to 3 in quick succession if they haven't sent many recently.
  sendMessage: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },

  failedLogins: { kind: "token bucket", rate: 10, period: HOUR },

  // Use sharding to increase throughput without compromising on correctness.
  llmTokens: { kind: "token bucket", rate: 40000, period: MINUTE, shards: 10 },
  llmRequests: { kind: "fixed window", rate: 1000, period: MINUTE, shards: 10 },
});
```

**Notes:**

- You can safely generate multiple instances if you want different rates in separate places, provided the keys don't overlap.
- The units for `period` are milliseconds. `MINUTE` above is `60000`.

---

## Strategies

**Token bucket**: Provides guarantees for overall consumption via `rate` per `period` at which tokens are added, while allowing unused tokens to accumulate (like "rollover" minutes) up to some `capacity` value. So if you could normally send 10 per minute with a capacity of 20, every two minutes you could send 20, or if in the last two minutes you only sent 5, you can send 15 now.

**Fixed window**: Tokens are granted all at once every `period` milliseconds. It similarly allows accumulating "rollover" tokens up to a `capacity` (defaults to `rate` for both strategies). You can specify a custom `start` time if, e.g., you want the period to reset at a specific time of day. By default it will be random to help space out retrying requests.

---

## Usage

### Using a simple global rate limit

```ts
const { ok, retryAfter } = await rateLimiter.limit(ctx, "freeTrialSignUp");
```

- `ok`: Whether it successfully consumed the resource.
- `retryAfter`: When it would have succeeded in the future.

> **Note**: If many clients use `retryAfter` to decide when to retry, add jitter to defend against a thundering herd. Or use the `reserve` functionality below.

### Per-user rate limit

Use `key` for a rate limit specific to a user / team / session ID:

```ts
const status = await rateLimiter.limit(ctx, "sendMessage", { key: userId });
```

### Consume a custom count

By default, each call to `limit` counts as one unit. Pass `count` to customize:

```ts
// Consume multiple in one request to prevent rate limits on an LLM API.
const status = await rateLimiter.limit(ctx, "llmTokens", { count: tokens });
```

### Throw automatically

By default it returns `{ ok, retryAfter }`. To throw when the limit is exceeded, use `throws`. It throws a `ConvexError` with `RateLimitError` data (`data: { kind, name, retryAfter }`) instead of returning when `ok` is false:

```ts
await rateLimiter.limit(ctx, "failedLogins", { key: userId, throws: true });
```

### Check a rate limit without consuming it

```ts
const status = await rateLimiter.check(ctx, "failedLogins", { key: userId });
```

### Reset a rate limit

```ts
// Reset a rate limit on successful login
await rateLimiter.reset(ctx, "failedLogins", { key: userId });
```

### Define a rate limit inline / dynamically

```ts
// Use a one-off rate limit config (when not named on initialization)
const config = { kind: "fixed window", rate: 1, period: SECOND };
const status = await rateLimiter.limit(ctx, "oneOffName", { config });
```

---

## Using the React hook

You can use the React hook to check the rate limit in your browser code.

**1. Define the server API** to get the rate limit value:

```ts
// In convex/example.ts
export const { getRateLimit, getServerTime } = rateLimiter.hookAPI(
  "sendMessage",
  {
    // Optionally provide a key function to get the key for the rate limit
    key: async (ctx) => await getUserId(ctx),

    // To allow the client to provide the key, pass a function that takes the key from the client
    key: async (ctx, keyFromClient) => {
      await ensureUserCanUseKey(ctx, keyFromClient);
      return keyFromClient;
    },
  },
);
```

**2. Use the React hook** to check the rate limit:

```tsx
function App() {
  const {
    status: { ok, retryAt },
    check,
  } = useRateLimit(api.example.getRateLimit, {
    // [recommended] Allows the hook to sync the browser and server clocks
    getServerTimeMutation: getServerTime,
    // [optional] The number of tokens to wait on
    count: 1,
  });

  // If you want to check at specific times and get the concrete value:
  const { value, ts, config, ok, retryAt } = check(Date.now(), count);
}
```

### Fetching the current value directly

```ts
const { config, value, ts } = await rateLimiter.getValue(ctx, "sendMessage", {
  key: userId,
});
```

Calculate the value at a given timestamp:

```ts
import { calculateRateLimit } from "@convex-dev/rate-limiter";

const { config, value, ts } = calculateRateLimit(
  { value, ts },
  config,
  Date.now(),
  count || 0,
);
```

---

## Scaling rate limiting with shards

When many requests happen at once, they can all try to modify the same values. Convex provides strong transactions, so they won't overwrite each other. However, high contention causes optimistic concurrency control conflicts. Convex retries with backoff, but it's best to avoid them.

Use **sharding** to break up total capacity into buckets. When consuming capacity, check a random shard. Sometimes you'll get rate limited when capacity exists elsewhere, but you'll never violate the upper bound:

```ts
const rateLimiter = new RateLimiter(components.rateLimiter, {
  llmTokens: { kind: "token bucket", rate: 40000, period: MINUTE, shards: 10 },
  llmRequests: { kind: "fixed window", rate: 1000, period: MINUTE, shards: 10 },
});
```

For ~1,000 QPM, use 10 shards. Rough math: max queries per second ÷ 2. Each shard should have five (ideally ten) or more capacity. Here we have ten (`rate / shards`) and don't expect normal traffic to exceed ~20 QPS.

**Tip**: For `{ rate: 100, period: SECOND }` with flexible period, shard by increasing rate and period proportionally:

```ts
{ shards: 50, rate: 250, period: 2.5 * SECOND }
// or even better:
{ shards: 50, rate: 1000, period: 10 * SECOND }
```

### Power of two

We check two shards and use the one with more capacity to keep them balanced, based on the "power of two" technique. We also combine capacity of two shards if neither has enough on its own.

---

## Reserving capacity

Use `reserve` to avoid starvation on larger requests. When you reserve capacity ahead of time, you can run your operation at the specified time (via `retryAfter`) without re-checking the rate limit. Your capacity has been "ear-marked."

Queue up many operations and they will run at spaced-out intervals, maximizing utilization.

**Example:**

```ts
const myAction = internalAction({
  args: {
    // ...
    skipCheck: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!args.skipCheck) {
      // Reserve future capacity instead of just failing now
      const status = await rateLimiter.limit(ctx, "llmRequests", {
        reserve: true,
      });
      if (status.retryAfter) {
        return ctx.scheduler.runAfter(
          status.retryAfter,
          internal.foo.myAction,
          {
            skipCheck: true, // We've reserved that capacity
          },
        );
      }
    }
    // do the operation
  },
});
```

---

## Adding jitter

When too many users show up at once, it can cause network congestion, database contention, and consume shared resources unnecessarily. Return a random time within the next period to retry:

```ts
const retryAfter = status.retryAfter + Math.random() * period;
```

For fixed window, we also pick the window start time randomly if `config.start` wasn't provided, helping prevent all clients from flooding at midnight.

---

## More resources

Check out a full example in the [official Convex docs](https://docs.convex.dev). See the related article for usage and advanced patterns:

- How the different rate limiting strategies work under the hood
- Using multiple rate limits in a single transaction
- Rate limiting anonymous users
