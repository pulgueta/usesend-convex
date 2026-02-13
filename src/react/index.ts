"use client";

import { useQuery, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";

/**
 * React hooks for useSend Convex Component.
 *
 * These hooks make it easy to interact with the useSend component from React components.
 */

/**
 * Hook to get the status of an email.
 *
 * Example:
 * ```tsx
 * function EmailStatus({ emailId }: { emailId: string }) {
 *   const { status, isLoading } = useEmailStatus(api.usesend.getStatus, emailId);
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (!status) return <div>Email not found</div>;
 *
 *   return (
 *     <div>
 *       <p>Status: {status.status}</p>
 *       {status.delivered && <p>Delivered!</p>}
 *       {status.opened && <p>Opened!</p>}
 *       {status.clicked && <p>Clicked!</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useEmailStatus(
  getStatusQuery: FunctionReference<"query">,
  emailId: string | null,
) {
  const status = useQuery(getStatusQuery, emailId ? { emailId } : "skip");

  return {
    status,
    isLoading: status === undefined,
  };
}

/**
 * Hook to track email sending state.
 *
 * Example:
 * ```tsx
 * function SendEmailButton() {
 *   const { sendEmail, isSending, error } = useSendEmail(api.usesend.sendEmail);
 *
 *   const handleClick = async () => {
 *     try {
 *       const emailId = await sendEmail({
 *         from: "sender@example.com",
 *         to: "recipient@example.com",
 *         subject: "Hello",
 *         html: "<p>Hello!</p>",
 *       });
 *       console.log("Email sent:", emailId);
 *     } catch (err) {
 *       console.error("Failed to send:", err);
 *     }
 *   };
 *
 *   return (
 *     <button onClick={handleClick} disabled={isSending}>
 *       {isSending ? "Sending..." : "Send Email"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useSendEmail(sendEmailMutation: FunctionReference<"mutation">) {
  const send = useMutation(sendEmailMutation);

  return {
    sendEmail: send,
    isSending: false, // Convex mutations don't expose pending state by default
  };
}

/**
 * Hook to list emails by status.
 *
 * Example:
 * ```tsx
 * function EmailList() {
 *   const { emails, isLoading } = useEmailsByStatus(
 *     api.usesend.listByStatus,
 *     "delivered",
 *     10
 *   );
 *
 *   if (isLoading) return <div>Loading...</div>;
 *
 *   return (
 *     <ul>
 *       {emails?.map((email) => (
 *         <li key={email._id}>
 *           {email.to.join(", ")} - {email.subject}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useEmailsByStatus(
  listQuery: FunctionReference<"query">,
  status: string,
  limit?: number,
) {
  const emails = useQuery(listQuery, { status, limit });

  return {
    emails,
    isLoading: emails === undefined,
  };
}
