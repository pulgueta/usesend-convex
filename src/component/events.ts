import type { Doc } from "./_generated/dataModel.js";
import type { EmailEvent, Status } from "./shared.js";

export const FINALIZED_EPOCH = Number.MAX_SAFE_INTEGER;

type EmailPatch = Partial<Omit<Doc<"emails">, "_id" | "_creationTime">>;

const STATUS_RANK: Record<Status, number> = {
  waiting: 0,
  queued: 1,
  sent: 2,
  delivery_delayed: 3,
  delivered: 4,
  bounced: 5,
  failed: 5,
  cancelled: 100,
};

export function computeEmailUpdateFromEvent(
  email: Doc<"emails">,
  event: EmailEvent,
): EmailPatch | null {
  const currentRank = STATUS_RANK[email.status];
  const canUpgradeTo = (next: Status) =>
    email.status !== "cancelled" && STATUS_RANK[next] > currentRank;

  if (email.status === "cancelled") return null;

  if (event.type === "email.sent" || event.type === "email.queued") return null;

  if (event.type === "email.clicked") {
    return email.clicked ? null : { clicked: true };
  }

  if (event.type === "email.failed") {
    const statusWillChange = canUpgradeTo("failed");
    if (!statusWillChange && email.failed) return null;
    const patch: EmailPatch = { failed: true };
    if (statusWillChange) {
      patch.status = "failed";
      patch.finalizedAt = Date.now();
    }
    if (event.data.failed) {
      patch.errorMessage = event.data.failed.reason;
    }
    return patch;
  }

  if (event.type === "email.delivered") {
    return canUpgradeTo("delivered")
      ? { status: "delivered", finalizedAt: Date.now() }
      : null;
  }

  if (event.type === "email.bounced") {
    const statusWillChange = canUpgradeTo("bounced");
    if (!statusWillChange && email.bounced) return null;
    const patch: EmailPatch = {
      bounced: true,
      errorMessage: event.data.bounce.message,
    };
    if (statusWillChange) {
      patch.status = "bounced";
      patch.finalizedAt = Date.now();
    }
    return patch;
  }

  if (event.type === "email.delivery_delayed") {
    const statusWillChange = canUpgradeTo("delivery_delayed");
    if (!statusWillChange && email.deliveryDelayed) return null;
    const patch: EmailPatch = { deliveryDelayed: true };
    if (statusWillChange) patch.status = "delivery_delayed";
    return patch;
  }

  if (event.type === "email.complained") {
    if (email.complained) return null;
    return {
      complained: true,
      finalizedAt:
        email.finalizedAt === FINALIZED_EPOCH ? Date.now() : email.finalizedAt,
    };
  }

  if (event.type === "email.opened") {
    return email.opened ? null : { opened: true };
  }

  if (event.type === "email.cancelled") {
    return canUpgradeTo("cancelled")
      ? { status: "cancelled", finalizedAt: Date.now() }
      : null;
  }

  const statusWillChange = canUpgradeTo("failed");
  if (!statusWillChange && email.failed) return null;
  const patch: EmailPatch = { failed: true };
  if (statusWillChange) {
    patch.status = "failed";
    patch.finalizedAt = Date.now();
  }
  if (event.type === "email.suppressed") {
    patch.errorMessage = `Suppressed: ${event.data.suppression.reason}`;
  }
  return patch;
}
