import type { Metadata } from "next";
import { AppShell } from "@/components/app/app-shell";
import { clientEnv } from "@/lib/env/client";

export const metadata: Metadata = { title: "Editor" };

export default function EditorPage() {
  return (
    <AppShell title="Editor" breadcrumb={`app.${clientEnv.NEXT_PUBLIC_ROOT_DOMAIN} / editor`}>
      <div className="max-w-[640px] rounded-md border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold">Coming in Milestone 1</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-text-2">
          The editor arrives in Milestone 1, together with sign-in and handle claim.
        </p>
      </div>
    </AppShell>
  );
}
