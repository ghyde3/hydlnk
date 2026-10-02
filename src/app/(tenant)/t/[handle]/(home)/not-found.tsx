/**
 * Intentionally empty. A handle with nothing to show calls notFound() in page.tsx, which sets the
 * 404 status; what the visitor sees (the claim panel or the plain 404) is drawn by layout.tsx
 * around this boundary, because a not-found file cannot know the handle without reading request
 * headers, and that would make every tenant page dynamic.
 */
export default function HandleNotFound() {
  return null;
}
