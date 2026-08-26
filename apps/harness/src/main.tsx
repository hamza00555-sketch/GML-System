import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@gml/ui/tokens.css";
import "@gml/ui/panel.css";
import "./harness.css";
import { HarnessApp } from "./HarnessApp.js";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <HarnessApp />
  </StrictMode>,
);
