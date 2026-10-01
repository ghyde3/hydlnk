import { notFound } from "next/navigation";

/** Custom-domain pages have no sub-paths yet: /sites/<pageId>/anything is the plain tenant 404. */
export default function UnknownSitePath(): never {
  notFound();
}
