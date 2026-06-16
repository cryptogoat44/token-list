/**
 * Sélection du mode de jeu : DÉMO LOCALE (par défaut) vs SERVEUR autoritaire.
 *
 * Le client est « bi-mode » :
 *  - sans configuration, il tourne en démo locale (moteur dans le navigateur,
 *    monnaie fictive) — c'est ce qui est déployé publiquement aujourd'hui ;
 *  - si `VITE_RGS_URL` est défini au build, il se connecte au Remote Game
 *    Server (serveur = seule source de vérité, le client n'est qu'un afficheur).
 *
 * Tant qu'aucune URL n'est fournie, RIEN ne change pour la démo en ligne.
 */

/** URL du serveur RGS (ws:// ou wss://), ou undefined en démo locale. */
export function getRgsUrl(): string | undefined {
  const raw = import.meta.env?.VITE_RGS_URL;
  if (typeof raw !== "string") return undefined;
  const url = raw.trim();
  return url.length > 0 ? url : undefined;
}

/** true si le client doit se connecter au serveur autoritaire. */
export function isServerMode(): boolean {
  return getRgsUrl() !== undefined;
}
