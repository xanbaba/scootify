import { useEffect, useState } from "react";
import { CampusMap } from "./CampusMap";

type ConnectionStatus = "checking" | "connected" | "unavailable";

const connectionLabels: Record<ConnectionStatus, string> = {
  checking: "Checking API connection…",
  connected: "API connected",
  unavailable: "API unavailable",
};

function ApiStatus() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setStatus("unavailable");
      controller.abort();
    }, 5000);

    async function checkHealth() {
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Health check returned ${response.status}`);
        }

        const data: { status?: unknown } = await response.json();
        setStatus(data.status === "ok" ? "connected" : "unavailable");
      } catch {
        if (!controller.signal.aborted) {
          setStatus("unavailable");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void checkHealth();

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt]);

  return (
    <div className="api-status">
      <span className={`status-dot ${status}`} aria-hidden="true" />
      <span role="status">{connectionLabels[status]}</span>
      {status === "unavailable" && (
        <button
          type="button"
          onClick={() => {
            setStatus("checking");
            setAttempt((previous) => previous + 1);
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function AdminView() {
  return (
    <>
      <h1>Campus maintenance</h1>
      <section className="panel" aria-labelledby="reports-title">
        <h2 id="reports-title">Reports and closures</h2>
        <p>Report and closure controls are pending.</p>
      </section>
    </>
  );
}

export function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const isStudent = path === "/";
  const isAdmin = path === "/admin";

  if (isStudent) return <CampusMap />;

  return (
    <div className="shell">
      <header className="site-header">
        <a className="brand" href="/">Scootify</a>
        <nav aria-label="Views">
          <a href="/">Student</a>
          <a href="/admin" aria-current={isAdmin ? "page" : undefined}>Admin</a>
        </nav>
      </header>
      <main>
        {isAdmin && <AdminView />}
        {!isAdmin && (
          <>
            <h1>Page unavailable</h1>
            <a href="/">Back to student view</a>
          </>
        )}
        <ApiStatus />
      </main>
    </div>
  );
}
