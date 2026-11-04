import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PowerProvider } from "./PowerProvider";
import { StoreProvider } from "./data/store";
import App from "./App";
import "@fontsource-variable/noto-sans";
import "./theme.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PowerProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </PowerProvider>
  </StrictMode>,
);
