/**
 * Node-only entry point.
 *
 * Hashing needs `node:crypto`, which a CEP panel has (Node is enabled in the
 * manifest) but a plain browser bundle does not. Keeping it out of the main
 * entry means importing `@gml/storage` never drags a Node built-in into a
 * browser build such as the harness.
 */
export * from "./hash.js";
