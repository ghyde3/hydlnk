import {
  AUTHORIZE_ERROR_NEXT,
  AUTHORIZE_ERROR_REASON,
  AUTHORIZE_ERROR_TITLE,
  OPEN_SETTINGS,
  type AuthorizeErrorClass,
} from "@/lib/oauth/messages";

/** The error page of /oauth/authorize: a title, one fixed reason by class, and the way out. It echoes nothing of the request. */
export function AuthorizeErrorScreen({ errorClass }: { errorClass: AuthorizeErrorClass }) {
  return (
    <div className="stack">
      <h1>{AUTHORIZE_ERROR_TITLE}</h1>
      <p>{AUTHORIZE_ERROR_REASON[errorClass]}</p>
      <p>{AUTHORIZE_ERROR_NEXT}</p>
    </div>
  );
}

/** One sentence, no form: a request that expired, was answered, belongs to someone else, or hit a limit. */
export function MessageScreen({
  text,
  settingsHref,
}: {
  text: string;
  /** Set only for the grant-limit page: where to remove an app. */
  settingsHref?: string;
}) {
  return (
    <div className="stack">
      <h1>{text}</h1>
      {settingsHref ? (
        <div className="actions">
          <a className="btn primary" href={settingsHref}>
            {OPEN_SETTINGS}
          </a>
        </div>
      ) : null}
    </div>
  );
}
