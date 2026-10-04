import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";
import { requestPersistentStorage } from "./offline/db";
import { syncEngine } from "./sync/engine";

// Service worker: la app (HTML/JS/CSS/iconos) queda en caché para abrir sin red.
registerSW({ immediate: true });

void requestPersistentStorage();
void syncEngine.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
