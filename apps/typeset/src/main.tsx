import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "@typeset/editor/styles/index.css";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
