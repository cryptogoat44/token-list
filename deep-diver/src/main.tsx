import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import ServerModeApp from "./ui/ServerModeApp";
import { isServerMode } from "./net/config";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Élément #root introuvable");

// Bi-mode : démo locale par défaut (déployée publiquement) ; mode serveur
// autoritaire si VITE_RGS_URL est défini au build. Aucun impact sur la démo
// tant qu'aucune URL n'est fournie.
const Root = isServerMode() ? ServerModeApp : App;

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
