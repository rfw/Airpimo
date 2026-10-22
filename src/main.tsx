import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { disableContextMenu } from "./lib/context-menu";
import "./styles.css";

// Capture events before React or browser defaults, including inputs and dialogs.
disableContextMenu(document);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
