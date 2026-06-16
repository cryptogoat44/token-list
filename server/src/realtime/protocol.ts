/**
 * Protocole temps réel — ré-export de la SOURCE UNIQUE partagée (`shared/`).
 *
 * La définition vit dans `shared/protocol.ts` afin que le serveur et le client
 * web parlent exactement le même protocole de fil (impossible de diverger). Ce
 * fichier ne fait que ré-exporter pour que le reste du serveur continue
 * d'importer depuis `./protocol`.
 *
 * Rappel sécurité : l'état diffusé n'inclut JAMAIS `crashAt` ni la graine
 * serveur avant le crash (voir `shared/protocol.ts`).
 */
export {
  WIRE_PROTOCOL_VERSION,
  parseClientMessage,
  encodeClientMessage,
} from "../../../shared/protocol";
export type {
  RoundPhase,
  PublicRoundState,
  ServerMessage,
  ClientMessage,
} from "../../../shared/protocol";
