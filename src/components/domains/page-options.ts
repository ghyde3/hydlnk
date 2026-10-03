/** One of the account's pages, as the "Serves" selects list it: its name and its hydlnk.com address. */
export interface PageOption {
  id: string;
  /** The page's private name (M6-13): "Main page" until its owner renames it. */
  name: string;
  /** "mara.hydlnk.com". */
  address: string;
  /** The page has a published version; a domain pointing at one that has not shows a 404. */
  published: boolean;
}

/** What a "Serves" choice reads: "Main page · mara.hydlnk.com" (two pages may share a name, the address tells them apart). */
export function pageOptionLabel(option: Pick<PageOption, "name" | "address">): string {
  return `${option.name} · ${option.address}`;
}
