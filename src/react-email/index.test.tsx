import { describe, expect, test, vi } from "vitest";
import { Button, Html, Text } from "react-email";
import { renderEmail, sendReactEmail } from "./index.js";
import { UseSend } from "../client/index.js";

function TestEmail({ name }: { name: string }) {
  return (
    <Html lang="en">
      <Text>{`Hello ${name}!`}</Text>
      <Button href="https://example.com/verify">Verify</Button>
    </Html>
  );
}

describe("renderEmail", () => {
  test("renders client-safe HTML and a plain-text fallback", async () => {
    const { html, text } = await renderEmail(<TestEmail name="Ada" />);

    expect(html).toContain("<!DOCTYPE html");
    expect(html).toContain('lang="en"');
    expect(html).toContain("Hello Ada!");
    expect(html).toContain('href="https://example.com/verify"');

    expect(text).toContain("Hello Ada!");
    expect(text).not.toContain("<html");
    expect(text).not.toContain("</");
  });
});

describe("sendReactEmail", () => {
  test("renders the element and enqueues html + text through the component", async () => {
    const mockComponent = { lib: { sendEmail: "sendEmail" } } as any;
    const usesend = new UseSend(mockComponent, { apiKey: "test-api-key" });
    const runMutation = vi.fn().mockResolvedValue("email_1");

    const emailId = await sendReactEmail(
      usesend,
      { runMutation },
      {
        from: "Acme <hello@acme.com>",
        to: "ada@example.com",
        subject: "Welcome",
        react: <TestEmail name="Ada" />,
        scheduledAt: "2026-08-01T09:00:00Z",
      },
    );

    expect(emailId).toBe("email_1");
    expect(runMutation).toHaveBeenCalledOnce();
    const args = runMutation.mock.calls[0][1];
    expect(args.from).toBe("Acme <hello@acme.com>");
    expect(args.to).toEqual(["ada@example.com"]);
    expect(args.subject).toBe("Welcome");
    expect(args.scheduledAt).toBe("2026-08-01T09:00:00Z");
    expect(args.html).toContain("Hello Ada!");
    expect(args.text).toContain("Hello Ada!");
    expect(args.react).toBeUndefined();
  });
});
