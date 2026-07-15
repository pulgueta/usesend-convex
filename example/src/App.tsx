import "./App.css";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";

function App() {
  const sendTestEmail = useMutation(api.example.sendTestEmail);
  const cancelEmail = useMutation(api.example.cancelEmail);
  const [emailId, setEmailId] = useState<string | null>(null);
  const status = useQuery(
    api.example.getEmailStatus,
    emailId ? { emailId } : "skip",
  );

  // Replace .convex.cloud with .convex.site for HTTP endpoints
  const convexUrl =
    import.meta.env.VITE_CONVEX_URL?.replace(".cloud", ".site") ||
    "https://<your-deployment>.convex.site";

  const handleSend = async () => {
    const id = await sendTestEmail();
    setEmailId(id);
  };

  return (
    <>
      <h1>useSend Component Example</h1>
      <div className="card">
        <div
          style={{
            padding: "1.5rem",
            border: "1px solid rgba(128, 128, 128, 0.3)",
            borderRadius: "8px",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Send a test email</h2>
          <button onClick={handleSend}>Send test email</button>
          {emailId && (
            <div style={{ marginTop: "1rem", textAlign: "left" }}>
              <p>
                <strong>Email ID:</strong> <code>{emailId}</code>
              </p>
              <p>
                <strong>Status:</strong> <code>{status?.status ?? "…"}</code>
              </p>
              {status?.errorMessage && (
                <p style={{ color: "#d32f2f" }}>
                  <strong>Error:</strong> {status.errorMessage}
                </p>
              )}
              {status?.status === "waiting" && (
                <button onClick={() => void cancelEmail({ emailId })}>
                  Cancel email
                </button>
              )}
            </div>
          )}
        </div>
        <div
          style={{
            padding: "1rem",
            backgroundColor: "rgba(128, 128, 128, 0.1)",
            borderRadius: "8px",
            textAlign: "left",
          }}
        >
          <h3>Webhook endpoint</h3>
          <p style={{ fontSize: "0.9rem" }}>
            Delivery status updates arrive via the useSend webhook. Point your
            useSend dashboard webhook at:
          </p>
          <code>{convexUrl}/usesend/webhook</code>
          <p style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.5rem" }}>
            See <code>example/convex/http.ts</code> for the HTTP route
            configuration.
          </p>
        </div>
        <p>
          See <code>example/convex/example.ts</code> for all the ways to use
          this component, including contacts, domains, campaigns, and analytics
          via <code>usesend.api</code>.
        </p>
      </div>
    </>
  );
}

export default App;
