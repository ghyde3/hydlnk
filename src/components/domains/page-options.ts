/** One of the account's pages, as the "Serves" selects list it: the page's hydlnk.com address. */
export interface PageOption {
  id: string;
  /** "mara.hydlnk.com". */
  address: string;
  /** The page has a published version; a domain pointing at one that has not shows a 404. */
  published: boolean;
}
