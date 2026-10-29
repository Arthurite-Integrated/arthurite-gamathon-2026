declare module 'dynalite' {
  import type { Server } from 'http';
  function dynalite(options?: { createTableMs?: number; deleteTableMs?: number; updateTableMs?: number }): Server;
  export = dynalite;
}
