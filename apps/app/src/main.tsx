import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Curtain } from "./ui/curtain.tsx";
import { initHost } from "./data/host.ts";
import { installTheme } from "./data/pack.ts";
import { sound } from "./audio/sound.ts";
import { installFullscreenKeys } from "./data/fullscreen.ts";
import { installTouchScroll } from "./data/touch.ts";
import "./styles.css";

initHost();
void installTheme();
sound.install();
installFullscreenKeys();
installTouchScroll();
// a soft click for every enabled button (the original's UI button sound)
document.addEventListener("click", (e) => {
  const b = (e.target as Element | null)?.closest?.("button");
  if (b && !(b as HTMLButtonElement).disabled) void sound.sfx(b.classList.contains("card") ? "MenuButton" : "SoftButton", 0.5);
}, { capture: true });
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Curtain />
  </StrictMode>,
);
