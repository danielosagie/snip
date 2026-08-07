import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VersionHistory } from "./VersionHistory";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VersionHistory />
  </StrictMode>,
);
