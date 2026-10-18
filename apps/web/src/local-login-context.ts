/** Nonsecret login hints from the selected local Manager installation, never authentication. */
export interface LocalLoginContext { tenantId: string; subject: string }
export function localLoginContext(location: Pick<Location, "href">): LocalLoginContext | null {
  let url: URL;
  try { url = new URL(location.href); } catch { return null; }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) return null;
  const tenants = url.searchParams.getAll("localTenant"), subjects = url.searchParams.getAll("localSubject");
  if (tenants.length !== 1 || subjects.length !== 1 || [...url.searchParams.keys()].some(key => !["localTenant", "localSubject"].includes(key))) return null;
  const tenantId = tenants[0]!, subject = subjects[0]!;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId) || !/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{2,127}$/.test(subject)) return null;
  return {tenantId, subject};
}
export function localLoginHref(context: LocalLoginContext | null): string {
  if (!context) return "/cms";
  return "/cms?" + new URLSearchParams({localTenant: context.tenantId, localSubject: context.subject}).toString();
}
