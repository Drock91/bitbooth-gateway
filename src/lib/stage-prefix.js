/**
 * Compute the base path prefix to prepend to absolute URLs so redirects
 * and links stay within the correct API Gateway stage.
 *
 * API Gateway puts the stage in event.requestContext.path but strips it
 * from event.path. When invoked via the stage URL (execute-api.../staging/*)
 * those two differ and the difference IS the prefix. When invoked via a
 * custom domain with BasePathMapping they're equal and this returns ''.
 *
 * Examples:
 *   stage URL:     rcPath="/staging/admin" ePath="/admin"  → "/staging"
 *   custom domain: rcPath="/admin"          ePath="/admin"  → ""
 *
 * @param {object} event  Lambda proxy integration event
 * @returns {string}  Base prefix (includes leading slash, no trailing slash), or ''
 */
export function stagePrefix(event) {
  const rcPath = event?.requestContext?.path;
  const ePath = event?.path;
  if (!rcPath || !ePath || !rcPath.endsWith(ePath)) return '';
  return rcPath.slice(0, rcPath.length - ePath.length);
}
