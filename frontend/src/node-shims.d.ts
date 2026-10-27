/* Minimal type shims so tests can read source files without adding
   a Node types package to the frontend. Used only by tests. */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
