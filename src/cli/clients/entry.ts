import type { ServerEntry } from './types.js';

/** Name of the server entry in every client config. */
export const SERVER_NAME = 'hesman';

/**
 * The command every client is told to launch. This is the single place that decides it:
 * each adapter derives its config entry from the value returned here.
 */
export function serverEntry(): ServerEntry {
  return { command: 'hesman', args: [] };
}
