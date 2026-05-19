import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";
import { CLERK_PUBLISHABLE_KEY } from "./config";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <App />
    </ClerkProvider>
  </React.StrictMode>,
);
