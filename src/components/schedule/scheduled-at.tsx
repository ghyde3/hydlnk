"use client";

import { useEffect, useState } from "react";
import { formatLocal, zoneLabel } from "@/lib/schedule/local-time";

/**
 * "Publishes 3 Dec, 09:00 (Europe/London, GMT+0)": a pending scheduled publish in the browser's
 * zone, drawn after mount (the server does not know the zone). The one line the Posts list and the
 * publish bar's page rows show under "Scheduled" (Wave E, M20-10).
 */
export function ScheduledAt({ iso, testId }: { iso: string; testId: string }) {
  const [text, setText] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- local times are drawn after mount
  useEffect(() => setText(`Publishes ${formatLocal(iso)} (${zoneLabel()})`), [iso]);
  return (
    <span data-testid={testId} className="font-mono text-xs text-ink">
      {text}
    </span>
  );
}
