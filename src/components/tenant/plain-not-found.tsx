/** Plain tenant 404 for sub-paths and addresses that are not a claimable handle: no theme to apply. */
export function PlainNotFound() {
  return (
    <main className="tenant-notfound">
      <h1>Page not found</h1>
      <p>This page doesn’t exist or hasn’t been published yet.</p>
    </main>
  );
}
