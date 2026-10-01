import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hl:px-6">
        <Logo />
        <span className="text-[13px] text-text-2">© {new Date().getFullYear()}</span>
      </div>
    </footer>
  );
}
