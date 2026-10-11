/** Note printed for clients whose way of telling the server which project is open is not documented. */
export function unverifiedProjectNote(label: string): string {
  return (
    `How ${label} tells an MCP server which project is open is unverified. After restarting it, check that a Hesman ` +
    'tool answers; if it reports NO_PROJECT, add "--project-root", "/path/to/project" to the args of the hesman entry. ' +
    '(`hesman doctor`, planned, will run this check.)'
  );
}
