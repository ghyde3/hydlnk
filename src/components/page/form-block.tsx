import type { FormBlock } from "@/lib/document";
import {
  FORM_FIELD,
  FORM_LABELS,
  FORM_VIEW_LINES,
  SUBMISSION_LIMITS,
  asksName,
  formActionPath,
  isBackHref,
  type FormRenderState,
  type SubmissionField,
} from "@/lib/forms/contract";
import { blockTokens, type BlockContext } from "./blocks";

/**
 * The form block (Wave D, M17-04): a sign-up or contact form as plain HTML. No script: it posts to
 * `/f/{pageId}/{blockId}`, and the confirm, error and sent states are pages of their own, drawn by
 * this same component with `ctx.form` (src/lib/tenant-render/form-page.tsx). Every author and visitor
 * text is React text; the action is built from the two ids. In the editor's phone dock it holds no
 * form control at all, only boxes with the same classes.
 */
export function FormView({ block, ctx }: { block: FormBlock; ctx: BlockContext }) {
  const { resolved, style } = blockTokens(ctx.tokens, block.overrides);
  const state = ctx.form?.blockId === block.id ? ctx.form : undefined;
  const root = {
    className: "pg-form",
    "data-block-id": block.id,
    "data-block-type": "form",
    "data-form-kind": block.kind,
    "data-button-style": resolved.buttonStyle,
    style,
  } as const;
  const heading = block.heading ?? "";
  const description = block.description ?? "";
  const withName = asksName(block.kind, block.askName === true);
  const withMessage = block.kind === "contact";

  if (state?.view === "sent") {
    return (
      <div {...root} data-form-view="sent">
        <p className="pg-form-sent" role="status">
          {block.successMessage}
        </p>
        <a className="pg-form-back" href={isBackHref(state.backHref) ? state.backHref : "/"}>
          {FORM_LABELS.back}
        </a>
      </div>
    );
  }

  const intro = state ? null : (
    <>
      {heading === "" ? null : <h2 className="pg-form-heading">{heading}</h2>}
      {description === "" ? null : <p className="pg-form-desc">{description}</p>}
    </>
  );

  if (ctx.thumbnail) {
    return (
      <div {...root}>
        {intro}
        {withName ? <FieldBox label={FORM_LABELS.name} /> : null}
        <FieldBox label={FORM_LABELS.email} />
        {withMessage ? <FieldBox label={FORM_LABELS.message} message /> : null}
        <span className="pg-form-submit">{block.buttonLabel}</span>
        <p className="pg-form-consent">{block.consent}</p>
      </div>
    );
  }

  const id = (field: string) => `f-${block.id}-${field}`;
  const values = state?.values;
  const errors = state?.errors ?? {};
  const invalid = (field: SubmissionField) =>
    errors[field]
      ? { "aria-invalid": true as const, "aria-describedby": id(`${field}-error`) }
      : {};
  const error = (field: SubmissionField) =>
    errors[field] ? (
      <p className="pg-form-error" id={id(`${field}-error`)}>
        {errors[field]}
      </p>
    ) : null;

  return (
    <form
      {...root}
      {...(state ? { "data-form-view": state.view } : {})}
      method="post"
      action={formActionPath(ctx.pageId, block.id)}
    >
      {intro}
      {state ? (
        <p className="pg-form-note" role={state.view === "error" ? "alert" : "status"}>
          {FORM_VIEW_LINES[state.view]}
        </p>
      ) : null}
      {withName ? (
        <>
          <label className="pg-form-label" htmlFor={id("name")}>
            {FORM_LABELS.name}
          </label>
          <input
            className="pg-form-input"
            id={id("name")}
            name={FORM_FIELD.name}
            type="text"
            autoComplete="name"
            maxLength={SUBMISSION_LIMITS.name}
            required={block.kind === "contact"}
            {...(values ? { defaultValue: values.name } : {})}
            {...invalid("name")}
          />
          {error("name")}
        </>
      ) : null}
      <label className="pg-form-label" htmlFor={id("email")}>
        {FORM_LABELS.email}
      </label>
      <input
        className="pg-form-input"
        id={id("email")}
        name={FORM_FIELD.email}
        type="email"
        autoComplete="email"
        maxLength={SUBMISSION_LIMITS.email}
        required
        {...(values ? { defaultValue: values.email } : {})}
        {...invalid("email")}
      />
      {error("email")}
      {withMessage ? (
        <>
          <label className="pg-form-label" htmlFor={id("message")}>
            {FORM_LABELS.message}
          </label>
          <textarea
            className="pg-form-input pg-form-message"
            id={id("message")}
            name={FORM_FIELD.message}
            maxLength={SUBMISSION_LIMITS.message}
            rows={5}
            required
            {...(values ? { defaultValue: values.message } : {})}
            {...invalid("message")}
          />
          {error("message")}
        </>
      ) : null}
      <div className="pg-form-hp" aria-hidden="true">
        <label htmlFor={id("hp")}>{FORM_LABELS.honeypot}</label>
        <input
          id={id("hp")}
          name={FORM_FIELD.honeypot}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <input type="hidden" name={FORM_FIELD.token} value={state?.token ?? ""} />
      <button className="pg-form-submit" type="submit">
        {block.buttonLabel}
      </button>
      <p className="pg-form-consent">{block.consent}</p>
    </form>
  );
}

/** A field in the editor's phone dock: its label and an empty box, no control. */
function FieldBox({ label, message }: { label: string; message?: boolean }) {
  return (
    <>
      <span className="pg-form-label">{label}</span>
      <span className={message ? "pg-form-input pg-form-message" : "pg-form-input"} />
    </>
  );
}
