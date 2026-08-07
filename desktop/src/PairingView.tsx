import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  PairingError,
  type PairingFailureCode,
  type PairingResult,
  runPairing,
} from "./pairing";

type PairingState =
  | { phase: "starting" }
  | { phase: "waiting"; approvalUrl: string }
  | { phase: "approved"; result: PairingResult }
  | { phase: "redeeming" }
  | {
      phase: "error";
      code: PairingFailureCode | "wrong-account" | "redemption";
      message: string;
    };

const initialLoadError = new URLSearchParams(window.location.search).get(
  "error",
);

export function PairingView() {
  const [state, setState] = useState<PairingState>(() =>
    initialLoadError === "redemption-load"
      ? {
          phase: "error",
          code: "redemption",
          message: "Could not load sign-in. Check your network and try again.",
        }
      : { phase: "starting" },
  );
  const attemptRef = useRef(0);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const start = useCallback(async () => {
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    cancelRef.current.cancelled = true;
    cancelRef.current = { cancelled: false };
    setState({ phase: "starting" });

    try {
      const config = await api.desktopAuth.config();
      if (attemptRef.current !== attempt) return;

      const result = await runPairing({
        deviceLabel: config.deviceLabel,
        webOrigin: config.webOrigin,
        signal: cancelRef.current,
        onOpened: (approvalUrl) => {
          if (attemptRef.current === attempt) {
            setState({ phase: "waiting", approvalUrl });
          }
        },
      });
      if (attemptRef.current !== attempt) return;
      setState({ phase: "approved", result });
    } catch (error) {
      if (attemptRef.current !== attempt) return;
      const pairingError =
        error instanceof PairingError
          ? error
          : new PairingError("network", "Connection failed. Try again.");
      setState({
        phase: "error",
        code: pairingError.code,
        message: pairingError.message,
      });
    }
  }, []);

  useEffect(() => {
    if (!initialLoadError) void start();
    return () => {
      cancelRef.current.cancelled = true;
      attemptRef.current += 1;
    };
  }, [start]);

  const cancel = () => {
    cancelRef.current.cancelled = true;
    attemptRef.current += 1;
    setState({
      phase: "error",
      code: "cancelled",
      message: "Connection cancelled. Try again or use email.",
    });
  };

  const useEmail = async () => {
    cancelRef.current.cancelled = true;
    attemptRef.current += 1;
    try {
      const { url } = await api.desktopAuth.useEmail();
      window.location.assign(url);
    } catch {
      setState({
        phase: "error",
        code: "redemption",
        message: "Could not open email sign-in. Restart the app.",
      });
    }
  };

  const redeem = async (result: PairingResult) => {
    setState({ phase: "redeeming" });
    try {
      const { url } = await api.desktopAuth.redeemTicket(result.signInToken);
      window.location.assign(url);
    } catch {
      setState({
        phase: "error",
        code: "redemption",
        message: "Could not finish sign-in. Try again.",
      });
    }
  };

  const wrongAccount = () => {
    setState({
      phase: "error",
      code: "wrong-account",
      message: "Sign out in your browser. Then try again.",
    });
  };

  return (
    <main
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#fafafa",
      }}
    >
      <header
        className="titlebar"
        style={{
          height: 56,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 20px 0 76px",
          fontSize: 14,
          fontWeight: 650,
          letterSpacing: "-0.01em",
          background: "rgba(255, 255, 255, 0.9)",
          boxShadow: "0 1px 0 rgba(0, 0, 0, 0.08)",
        }}
      >
        snip<span style={{ color: "#ff6600" }}>.</span> desktop
      </header>

      <section
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
        }}
      >
        <div style={{ width: "100%", maxWidth: 420 }}>
          <Status state={state} />
          <Actions
            state={state}
            onCancel={cancel}
            onRetry={() => void start()}
            onUseEmail={() => void useEmail()}
            onRedeem={(result) => void redeem(result)}
            onWrongAccount={wrongAccount}
          />
        </div>
      </section>
    </main>
  );
}

function Status({ state }: { state: PairingState }) {
  const content = (() => {
    switch (state.phase) {
      case "starting":
        return {
          label: "Starting",
          title: "Opening your browser",
          body: "Sign in there to connect this app.",
        };
      case "waiting":
        return {
          label: "Waiting",
          title: "Check your browser",
          body: "Sign in and approve this device.",
        };
      case "approved": {
        const userName = state.result.userName || "this account";
        return {
          label: "Approved",
          title: `Continue as ${userName}?`,
          body: "Your browser approved this account.",
        };
      }
      case "redeeming":
        return {
          label: "Signing in",
          title: "Finishing sign-in",
          body: "This should only take a moment.",
        };
      case "error":
        return {
          label: state.code === "wrong-account" ? "Account" : "Stopped",
          title:
            state.code === "wrong-account"
              ? "Wrong account"
              : state.code === "expired"
                ? "Connection expired"
                : state.code === "timeout"
                  ? "No approval received"
                  : "Could not connect",
          body: state.message,
        };
    }
  })();

  return (
    <div>
      <div
        style={{
          marginBottom: 14,
          color: state.phase === "error" ? "#b42318" : "#ff6600",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {content.label}
      </div>
      <h1
        style={{
          margin: 0,
          color: "#131315",
          fontSize: 30,
          lineHeight: 1.15,
          letterSpacing: "-0.035em",
          textWrap: "balance",
        }}
      >
        {content.title}
        <span style={{ color: "#ff6600" }}>.</span>
      </h1>
      <p
        style={{
          margin: "12px 0 0",
          color: "#6e6e73",
          fontSize: 14,
          lineHeight: 1.55,
          textWrap: "pretty",
        }}
      >
        {content.body}
      </p>
    </div>
  );
}

function Actions({
  state,
  onCancel,
  onRetry,
  onUseEmail,
  onRedeem,
  onWrongAccount,
}: {
  state: PairingState;
  onCancel: () => void;
  onRetry: () => void;
  onUseEmail: () => void;
  onRedeem: (result: PairingResult) => void;
  onWrongAccount: () => void;
}) {
  if (state.phase === "starting" || state.phase === "redeeming") {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        marginTop: 26,
      }}
    >
      {state.phase === "waiting" ? (
        <>
          <button
            className="primary"
            onClick={() => void api.shell.openExternal(state.approvalUrl)}
          >
            Open browser
          </button>
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </>
      ) : state.phase === "approved" ? (
        <>
          <button className="primary" onClick={() => onRedeem(state.result)}>
            Continue
          </button>
          <button className="secondary" onClick={onWrongAccount}>
            Wrong account
          </button>
        </>
      ) : (
        <>
          <button className="primary" onClick={onRetry}>
            Try again
          </button>
          <button className="secondary" onClick={onUseEmail}>
            Use email
          </button>
        </>
      )}
    </div>
  );
}
