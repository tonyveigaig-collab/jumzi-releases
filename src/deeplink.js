// jumzi:// links open JUMZI pages inside the desktop app:
//   jumzi://w/<workspaceId>                  an office
//   jumzi://w/<workspaceId>?room=<roomId>    walk to a room (asks for the elevator if on another floor)
//   jumzi://w/<workspaceId>?meeting=<id>     go to a meeting's room
//   jumzi://invite/<token>                   accept an invitation
//   jumzi://dashboard, jumzi://avatar
// Anything else is ignored: a link can only point at our own pages, with a fixed set of parameters.
const PROTOCOL = "jumzi";
const PATHS = [/^$/, /^dashboard$/, /^avatar$/, /^download$/, /^login$/, /^w\/[A-Za-z0-9_-]{1,64}$/, /^invite\/[A-Za-z0-9_-]{1,200}$/, /^reset$/];
const PARAMS = new Set(["room", "floor", "meeting", "token", "back"]);
const SAFE_VALUE = /^[A-Za-z0-9_\-/.]{1,200}$/;

/** jumzi://… → https URL on our site, or null if the link is not one we accept. */
function toAppUrl(link, appUrl) {
  // Dot segments would be resolved by the URL parser into another page: refuse them outright.
  if (typeof link !== "string" || link.length > 2048 || /\.\.|%2e/i.test(link)) return null;
  let u;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== `${PROTOCOL}:`) return null;
  // jumzi://w/abc parses as host "w" + path "/abc"; jumzi:///w/abc as path "/w/abc".
  const route = [u.hostname, ...u.pathname.split("/")].filter(Boolean).join("/");
  if (!PATHS.some((re) => re.test(route))) return null;
  const out = new URL(`${appUrl.replace(/\/$/, "")}/${route}`);
  for (const [k, v] of u.searchParams) if (PARAMS.has(k) && SAFE_VALUE.test(v)) out.searchParams.set(k, v);
  return out.toString();
}

/** A jumzi:// link among command-line arguments (Windows and Linux pass it there). */
const fromArgv = (argv) => argv.find((a) => typeof a === "string" && a.startsWith(`${PROTOCOL}://`)) ?? null;

module.exports = { PROTOCOL, toAppUrl, fromArgv };
