import React from "react";
import { createRoot } from "react-dom/client";
import { DaimonPromo } from "./DaimonPromo";

const container = document.getElementById("root");
const root = createRoot(container!);

root.render(
  <React.StrictMode>
    <div style={{ height: "100vh", width: "100vw" }}>
      <DaimonPromo />
    </div>
  </React.StrictMode>
);
