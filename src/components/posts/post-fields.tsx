"use client";

import type { ReactNode } from "react";
import { Field, controlClass } from "@/components/blocks/field";
import { ImageUploadControl } from "@/components/editor/image-upload-control";
import { ToggleRow } from "@/components/site/toggle-row";
import { POST_TEST_IDS } from "@/lib/blog/test-ids";
import { POST_LIMITS, entrySlugIssue } from "@/lib/content/schemas";
import { postFieldId, type PostForm } from "@/lib/posts/draft";

/**
 * The plain fields of the post editor (M16-13): title, slug, excerpt, featured image, and the search
 * fields. Each stores what is typed (the schemas validate at Publish); a long paste is cut to the
 * field's limit so the draft always saves. HYDLNK UI tokens only.
 */

const cut = (value: string, max: number) => [...value].slice(0, max).join("");
const oneLine = (value: string, max: number) => cut(value.replace(/[\r\n]+/g, " "), max);

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span className="font-mono text-[11px] text-text-2" aria-hidden="true">
      {[...value].length} / {max}
    </span>
  );
}

interface FieldsProps {
  form: PostForm;
  change: (patch: Partial<PostForm>) => void;
  disabled: boolean;
  /** The field messages Publish answered, by field. */
  errors: Partial<Record<"title" | "slug" | "excerpt" | "featuredImage" | "seo", string>>;
}

export function TitleField({ form, change, disabled, errors }: FieldsProps) {
  return (
    <div id={postFieldId("title")} className="scroll-mt-24">
      <Field label="Title" error={errors.title}>
        {(control) => (
          <input
            {...control}
            type="text"
            data-testid={POST_TEST_IDS.title}
            value={form.title}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => change({ title: oneLine(event.target.value, POST_LIMITS.title) })}
            className={controlClass(Boolean(errors.title), "text-lg font-semibold")}
          />
        )}
      </Field>
    </div>
  );
}

export function SlugField({
  form,
  change,
  disabled,
  errors,
  archivePath,
  following,
}: FieldsProps & {
  archivePath: string;
  /** The slug is still the one suggested from the title. */
  following: boolean;
}) {
  const typed = form.slug === "" ? null : entrySlugIssue(form.slug);
  const error = errors.slug ?? typed;
  return (
    <div id={postFieldId("slug")} className="scroll-mt-24">
      <Field
        label="Slug"
        error={error}
        hint={
          following
            ? "Suggested from the title. Edit it to choose your own."
            : "The last part of the post’s address."
        }
      >
        {(control) => (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              aria-hidden="true"
              className="font-mono text-sm [overflow-wrap:anywhere] text-text-2"
            >
              /{archivePath}/
            </span>
            <input
              {...control}
              type="text"
              data-testid={POST_TEST_IDS.slug}
              value={form.slug}
              disabled={disabled}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={80}
              onChange={(event) => change({ slug: event.target.value.replace(/^\/+/, "") })}
              className={controlClass(error != null, "min-w-0 flex-1 basis-40 font-mono")}
            />
          </div>
        )}
      </Field>
    </div>
  );
}

export function ExcerptField({ form, change, disabled, errors }: FieldsProps) {
  return (
    <div id={postFieldId("excerpt")} className="scroll-mt-24">
      <Field
        label="Excerpt"
        error={errors.excerpt}
        hint="Shown in the list of posts and in the feed."
        suffix={<Counter value={form.excerpt} max={POST_LIMITS.excerpt} />}
      >
        {(control) => (
          <textarea
            {...control}
            data-testid={POST_TEST_IDS.excerpt}
            value={form.excerpt}
            disabled={disabled}
            rows={3}
            onChange={(event) => change({ excerpt: cut(event.target.value, POST_LIMITS.excerpt) })}
            className={`${controlClass(Boolean(errors.excerpt), "py-2.5 leading-normal")} resize-y`}
          />
        )}
      </Field>
    </div>
  );
}

export function FeaturedImageField({ form, change, disabled, errors }: FieldsProps) {
  return (
    <div
      id={postFieldId("featuredImage")}
      data-testid={POST_TEST_IDS.featuredImage}
      className="flex min-w-0 scroll-mt-24 flex-col gap-1.5"
    >
      <span className="text-[13px] font-semibold text-ink-2">Featured image</span>
      <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">Featured image</legend>
        <ImageUploadControl
          value={form.featuredImage}
          kind="content"
          label="image"
          help="Shown at the top of the post and in the list of posts."
          onChange={(next) => change({ featuredImage: next })}
        />
      </fieldset>
      {errors.featuredImage ? (
        <p role="alert" className="m-0 text-[13px] text-bad">
          {errors.featuredImage}
        </p>
      ) : null}
    </div>
  );
}

export function SearchFields({ form, change, disabled, errors }: FieldsProps) {
  return (
    <div id={postFieldId("seo")} className="flex min-w-0 scroll-mt-24 flex-col gap-3">
      <Field
        label="Search title"
        hint="The title search engines and link previews show. Leave empty to use the post’s title."
        suffix={<Counter value={form.seoTitle} max={POST_LIMITS.seoTitle} />}
      >
        {(control) => (
          <input
            {...control}
            type="text"
            data-testid={POST_TEST_IDS.seoTitle}
            value={form.seoTitle}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) =>
              change({ seoTitle: oneLine(event.target.value, POST_LIMITS.seoTitle) })
            }
            className={controlClass(false)}
          />
        )}
      </Field>
      <Field
        label="Search description"
        hint="Leave empty to use the excerpt."
        suffix={<Counter value={form.seoDescription} max={POST_LIMITS.seoDescription} />}
      >
        {(control) => (
          <textarea
            {...control}
            data-testid={POST_TEST_IDS.seoDescription}
            value={form.seoDescription}
            disabled={disabled}
            rows={3}
            onChange={(event) =>
              change({ seoDescription: oneLine(event.target.value, POST_LIMITS.seoDescription) })
            }
            className={`${controlClass(false, "py-2.5 leading-normal")} resize-y`}
          />
        )}
      </Field>
      <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">Search engines</legend>
        <ToggleRow
          label="Hide from search engines"
          testId={POST_TEST_IDS.noindex}
          pressed={form.noindex}
          onToggle={() => change({ noindex: !form.noindex })}
        />
      </fieldset>
      {errors.seo ? (
        <p role="alert" className="m-0 text-[13px] text-bad">
          {errors.seo}
        </p>
      ) : null}
    </div>
  );
}

/** A white card of the post editor with its 14px/600 title. */
export function PostCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3.5 hl:p-5">
      <h2 className="m-0 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
