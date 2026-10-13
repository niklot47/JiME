import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { initHost } from "./data/host.ts";
import { installTheme } from "./data/pack.ts";
import "./styles.css";

initHost();
void installTheme();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
