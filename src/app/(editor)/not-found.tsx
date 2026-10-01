import Link from "next/link";
import { Logo } from "@/components/logo";
import { NotFoundPanel } from "@/components/not-found-panel";

export default function EditorNotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex min-h-14 items-center bg-ink px-4 text-on-ink hl:px-6">
        <Link href="/" aria-label="HYDLNK home" className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
      </div>
      <NotFoundPanel />
    </div>
  );
}
