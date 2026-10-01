import { notFound } from "next/navigation";

/** Catch-all for the app host: unknown paths get the app's 404. */
export default function UnknownAppPath(): never {
  notFound();
}
