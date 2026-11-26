/**
 * Words of the Publish gate that other modules match on (the schedule worker reads a refusal's reason
 * from them). A leaf module: no server-only import, so a pure reader does not pull in the gate.
 */

/** What Publish page and Publish design say on a site that was never published. */
export const SITE_NOT_LIVE_MESSAGE = "This site isn’t live yet. Use Publish all changes first.";
