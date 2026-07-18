import type { FC } from "react";
import { Html, Text } from "react-email";
import { expect, test } from "vitest";
import { components, initConvexTest } from "../../example/convex/test.setup.js";
import { UseSend } from "../client/index.js";
import { renderEmail, sendReactEmail, type RunMutationCtx } from "./index.js";

function TestEmail({ name }: { name: string }) {
  return (
    <Html lang="en">
      <Text>{`Hello ${name}!`}</Text>
    </Html>
  );
}

// FC-typed components return ReactNode when called directly (React 19 types);
// both entry points must accept them without createElement.
const FcEmail: FC<{ name: string }> = ({ name }) => (
  <Html lang="en">
    <Text>{`Bye ${name}!`}</Text>
  </Html>
);

test("renders React Email HTML and text from an action", async () => {
  const t = initConvexTest();
  const rendered = await t.action(async () =>
    renderEmail(<TestEmail name="Ada" />),
  );

  expect(rendered.html).toContain("<!DOCTYPE html");
  expect(rendered.html).toContain("Hello Ada!");
  expect(rendered.text).toContain("Hello Ada!");
  expect(rendered.text).not.toContain("<html");
});

test("enqueues a rendered React Email through the component", async () => {
  const t = initConvexTest();
  const usesend = new UseSend(components.usesend, { apiKey: "" });

  const emailId = await t.action((ctx) =>
    sendReactEmail(usesend, ctx, {
      from: "from@example.com",
      to: "ada@example.com",
      subject: "Welcome",
      react: <TestEmail name="Ada" />,
      scheduledAt: "2026-08-01T09:00:00Z",
    }),
  );
  const email = await t.run((ctx) => usesend.get(ctx, emailId));

  expect(email).toMatchObject({
    to: ["ada@example.com"],
    subject: "Welcome",
    status: "waiting",
    scheduledAt: "2026-08-01T09:00:00Z",
  });
  expect(email?.html).toContain("Hello Ada!");
  expect(email?.text).toContain("Hello Ada!");
});

test("rejects nodes that render no content", async () => {
  await expect(renderEmail(null)).rejects.toThrow("rendered no content");
});

test("accepts a direct call of an FC-typed component", async () => {
  const t = initConvexTest();
  const usesend = new UseSend(components.usesend, { apiKey: "" });

  const emailId = await t.action((ctx: RunMutationCtx) =>
    sendReactEmail(usesend, ctx, {
      from: "from@example.com",
      to: "ada@example.com",
      subject: "Farewell",
      react: FcEmail({ name: "Ada" }),
    }),
  );
  const email = await t.run((ctx) => usesend.get(ctx, emailId));

  expect(email?.html).toContain("Bye Ada!");
  expect(email?.text).toContain("Bye Ada!");
});
