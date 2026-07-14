import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "react-email";

export interface WelcomeEmailProps {
  name: string;
  verificationUrl: string;
}

export default function WelcomeEmail({
  name,
  verificationUrl,
}: WelcomeEmailProps) {
  return (
    <Html lang="en">
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              colors: {
                brand: "#0f172a",
              },
            },
          },
        }}
      >
        <Head />
        <Body className="bg-gray-100 font-sans">
          <Preview>Welcome aboard — verify your email to get started</Preview>
          <Container className="mx-auto my-10 max-w-[600px] rounded-lg bg-white p-8">
            <Heading className="m-0 text-2xl font-bold text-gray-900">
              {`Welcome, ${name}!`}
            </Heading>
            <Text className="text-base leading-6 text-gray-700">
              Thanks for signing up. Confirm your email address to activate
              your account.
            </Text>
            <Section className="my-6 text-center">
              <Button
                href={verificationUrl}
                className="box-border rounded bg-brand px-6 py-3 text-center text-base font-semibold text-white no-underline"
              >
                Verify email
              </Button>
            </Section>
            <Text className="text-sm leading-6 text-gray-500">
              Or copy this link into your browser:{" "}
              <Link href={verificationUrl} className="text-brand underline">
                {verificationUrl}
              </Link>
            </Text>
            <Hr className="my-6 border-solid border-gray-200" />
            <Text className="m-0 text-xs text-gray-400">
              You received this email because you signed up for the useSend
              Convex component example. If this wasn't you, you can safely
              ignore it.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

WelcomeEmail.PreviewProps = {
  name: "Ada Lovelace",
  verificationUrl: "https://example.com/verify?token=abc123",
} satisfies WelcomeEmailProps;
