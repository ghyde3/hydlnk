import { signOut } from "@/lib/auth/actions";

/**
 * 'Sign out' as a form that posts to the signOut Server Action (never a link: a GET must not log
 * anyone out). Works without JavaScript and from Server or Client Components. Full width below
 * 760px, content width from there up; `className` replaces the form's sizing classes.
 */
export function SignOutButton({
  className = "w-full hl:w-fit",
  label = "Sign out",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <form action={signOut} className={className}>
      <button
        type="submit"
        className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md border border-line-3 bg-surface px-5 text-[15px] font-semibold text-ink"
      >
        {label}
      </button>
    </form>
  );
}
