import { SCOPE_PUBLISH, SCOPE_READ, SCOPE_WRITE, type OauthScope } from "@/lib/oauth/constants";
import { clientInitials } from "@/lib/oauth/client-name";
import type { ConsentView } from "@/lib/oauth/authorize";
import {
  ALLOW_LABEL,
  CONNECTED_BEFORE,
  DENY_LABEL,
  LOOPBACK_WARNING,
  REGISTERED_NOT_VERIFIED,
  RETURN_LOOPBACK_LINE,
  SCOPE_LABELS,
  STAYS_CONNECTED,
  SUSPENDED_NOTICE,
  allowedNow,
  connectingAs,
  consentHeading,
  differentSiteLine,
  returnLine,
} from "@/lib/oauth/messages";

/**
 * The consent screen (M10-13): who is asking, where the person goes afterwards, who is signed in,
 * what the app gets, what can be unticked, and Allow or Deny. Every value shown is text and is escaped
 * by React: an app named `<img src=x onerror=alert(1)>` renders as those characters.
 *
 * The form posts the request id, the form secret, the decision and the scope ticks to
 * `/oauth/consent`, a route handler, so it works with JavaScript off. Read is always included (a
 * checked, disabled box that posts nothing: the server adds it). The focus order is the scopes, then
 * Allow, then Deny; on a wide screen the two buttons sit side by side with Deny on the left.
 */

function ScopeRow({ scope, fixed }: { scope: OauthScope; fixed?: boolean }) {
  const label = SCOPE_LABELS[scope];
  return (
    <label className={fixed ? "scope fixed" : "scope"}>
      <input
        type="checkbox"
        {...(fixed
          ? { disabled: true, defaultChecked: true }
          : { name: "scope", value: scope, defaultChecked: true })}
      />
      <span className="box" aria-hidden="true" />
      <span className="text">
        <span className="title">{label.title}</span>
        <span className="hint">{label.hint}</span>
      </span>
    </label>
  );
}

function Avatar({ name, logo }: { name: string; logo: string | null }) {
  return (
    <span className="avatar" aria-hidden="true">
      {logo ? (
        // A re-encoded data URI on a handler-rendered page: next/image has no part in it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} width={48} height={48} alt="" />
      ) : (
        clientInitials(name)
      )}
    </span>
  );
}

export function ConsentScreen({ view }: { view: ConsentView }) {
  const optional = view.scopes.filter((scope) => scope !== SCOPE_READ);
  return (
    <>
      <div className="who">
        <Avatar name={view.clientName} logo={view.logoDataUri} />
        <h1>{consentHeading(view.clientName)}</h1>
      </div>

      <ul className="facts">
        <li>
          {view.clientKind === "cimd" && view.clientHost ? (
            <>
              Address: <span className="mono">{view.clientHost}</span>
            </>
          ) : (
            REGISTERED_NOT_VERIFIED
          )}
        </li>
        <li>
          {view.returnIsLoopback ? (
            <>
              {RETURN_LOOPBACK_LINE} {LOOPBACK_WARNING}
            </>
          ) : (
            returnLine(view.returnLabel)
          )}
        </li>
        <li>{connectingAs(view.email)}</li>
        {view.differentSite ? <li>{differentSiteLine(view.differentSite)}</li> : null}
      </ul>

      {view.suspended ? <p className="notice bad">{SUSPENDED_NOTICE}</p> : null}
      {view.previous ? (
        <p className="notice">
          {CONNECTED_BEFORE} {allowedNow(view.previous)}
        </p>
      ) : null}

      <form method="post" action="/oauth/consent">
        <input type="hidden" name="request" value={view.requestId} />
        <input type="hidden" name="csrf" value={view.csrf} />
        <fieldset className="scopes">
          <legend>What it can do</legend>
          <ScopeRow scope={SCOPE_READ} fixed />
          {optional.includes(SCOPE_WRITE) ? <ScopeRow scope={SCOPE_WRITE} /> : null}
          {optional.includes(SCOPE_PUBLISH) ? <ScopeRow scope={SCOPE_PUBLISH} /> : null}
        </fieldset>
        <p className="after">{STAYS_CONNECTED}</p>
        <div className="actions">
          {view.suspended ? null : (
            <button type="submit" name="decision" value="allow" className="btn primary">
              {ALLOW_LABEL}
            </button>
          )}
          <button type="submit" name="decision" value="deny" className="btn secondary">
            {DENY_LABEL}
          </button>
        </div>
      </form>
    </>
  );
}
