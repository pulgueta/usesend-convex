/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      cancelEmail: FunctionReference<
        "mutation",
        "internal",
        { emailId: string },
        null,
        Name
      >;
      cleanupAbandonedEmails: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >;
      cleanupOldEmails: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >;
      cleanupOldEvents: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        {
          _creationTime: number;
          _id: string;
          bcc?: Array<string>;
          bounced: boolean;
          cc?: Array<string>;
          clicked: boolean;
          complained: boolean;
          deliveryDelayed: boolean;
          errorMessage?: string;
          failed: boolean;
          from: string;
          headers?: Array<{ name: string; value: string }>;
          html?: string;
          metadata?: Record<string, any>;
          opened: boolean;
          status:
            | "waiting"
            | "queued"
            | "sent"
            | "delivery_delayed"
            | "delivered"
            | "bounced"
            | "failed"
            | "cancelled"
            | "suppressed";
          subject?: string;
          template?: { id: string; variables?: Record<string, any> };
          text?: string;
          to: Array<string>;
          usesendId?: string;
        } | null,
        Name
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        {
          bounced: boolean;
          clicked: boolean;
          complained: boolean;
          deliveryDelayed: boolean;
          errorMessage: string | null;
          failed: boolean;
          opened: boolean;
          status:
            | "waiting"
            | "queued"
            | "sent"
            | "delivery_delayed"
            | "delivered"
            | "bounced"
            | "failed"
            | "cancelled"
            | "suppressed";
        } | null,
        Name
      >;
      listByStatus: FunctionReference<
        "query",
        "internal",
        {
          limit?: number;
          status:
            | "waiting"
            | "queued"
            | "sent"
            | "delivery_delayed"
            | "delivered"
            | "bounced"
            | "failed"
            | "cancelled"
            | "suppressed";
        },
        Array<{
          _creationTime: number;
          _id: string;
          from: string;
          status: string;
          subject?: string;
          to: Array<string>;
          usesendId?: string;
        }>,
        Name
      >;
      sendEmail: FunctionReference<
        "mutation",
        "internal",
        {
          bcc?: Array<string>;
          cc?: Array<string>;
          from: string;
          headers?: Array<{ name: string; value: string }>;
          html?: string;
          metadata?: Record<string, any>;
          options: {
            apiKey: string;
            baseUrl?: string;
            initialBackoffMs?: number;
            retryAttempts?: number;
            webhookSecret?: string;
          };
          replyTo?: Array<string>;
          subject?: string;
          template?: { id: string; variables?: Record<string, any> };
          text?: string;
          to: Array<string>;
        },
        string,
        Name
      >;
    };
  };
