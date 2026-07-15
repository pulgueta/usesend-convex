import { describe, expect, test } from "vitest";
import { renderEmail } from "@pulgueta/usesend-convex/react-email";
import WelcomeEmail from "./welcome.js";

describe("WelcomeEmail", () => {
  test("renders with Tailwind styles inlined and a plain-text fallback", async () => {
    const { html, text } = await renderEmail(
      <WelcomeEmail
        name="Ada Lovelace"
        verificationUrl="https://example.com/verify?token=abc123"
      />,
    );

    expect(html).toContain("<!DOCTYPE html");
    expect(html).toContain("Welcome, Ada Lovelace!");
    expect(html).toContain('href="https://example.com/verify?token=abc123"');
    // Tailwind classes must be compiled to inline styles for email clients
    expect(html).not.toContain('class="bg-gray-100');
    expect(html).toContain("background-color");

    // The plain-text renderer uppercases headings
    expect(text).toContain("WELCOME, ADA LOVELACE!");
    expect(text).toContain("https://example.com/verify?token=abc123");
    expect(text).not.toContain("<html");
  });
});
