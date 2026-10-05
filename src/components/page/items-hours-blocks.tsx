import {
  DAY_KEYS,
  DAY_LABELS,
  TIME_PATTERN,
  isHoursTimezone,
  type HoursBlock,
  type ItemsBlock,
  type ListItem,
} from "@/lib/document";
import { mediaUrl } from "@/lib/media/url";
import { LinkBox, blockTokens, type BlockContext } from "./blocks";
import { outboundHref } from "./outbound";

/**
 * The items and hours blocks (M12-01, M12-02), drawn by the same `BlockView` as every other block,
 * so the editor's preview and the public page cannot drift. Every word is the author's own text (a
 * React text node, so escaped) or a fixed word ("Sold", "Closed", the day names). An item's link is
 * the click redirect `/r/<pageId>/<itemId>` (no destination in the markup). Nothing here needs
 * JavaScript: the hours table is neutral static markup, and the one tenant script marks today and
 * adds "Open now" or "Closed now" in the visitor's browser (a cached page cannot know the day).
 */

// Items ------------------------------------------------------------------------------------------

function ItemBody({ item }: { item: ListItem }) {
  const image = item.image;
  const price = item.price.trim();
  return (
    <>
      {image ? (
        // A plain <img>: `path` is a validated reference into the page-media bucket. The name is
        // the item's text, so the picture itself has an empty alt.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="pg-item-img"
          src={mediaUrl(image.path)}
          alt=""
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <span className="pg-item-text">
        <span className="pg-item-head">
          <span className="pg-item-name">{item.name}</span>
          {price === "" ? null : (
            <span className="pg-item-price">{item.sold ? <s>{price}</s> : price}</span>
          )}
        </span>
        {item.sold ? <span className="pg-item-sold">Sold</span> : null}
        {item.description === "" ? null : <span className="pg-item-desc">{item.description}</span>}
      </span>
    </>
  );
}

/**
 * A price list or menu: an optional heading and the items as a list or a two-column grid. An item
 * with an address is one link (the whole item, through `/r`); one without is plain text. A sold
 * item says "Sold" and has its price struck through. Prices are display text only.
 */
export function ItemsView({ block, ctx }: { block: ItemsBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  return (
    <section
      className="pg-items"
      data-block-id={block.id}
      data-block-type="items"
      data-layout={block.layout === "grid" ? "grid" : "list"}
      style={style}
    >
      {block.heading ? <h2 className="pg-items-heading">{block.heading}</h2> : null}
      <ul className="pg-items-list">
        {block.items.map((item) => {
          const linked = (item.url ?? "").trim() !== "";
          const className = "pg-item-body";
          return (
            <li
              key={item.id}
              className="pg-item"
              data-item-id={item.id}
              data-sold={item.sold ? "true" : undefined}
            >
              {linked ? (
                <LinkBox
                  className={className}
                  thumbnail={ctx.thumbnail}
                  link={outboundHref(item.url, { pageId: ctx.pageId, id: item.id })}
                >
                  <ItemBody item={item} />
                </LinkBox>
              ) : (
                <div className={className}>
                  <ItemBody item={item} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Hours ------------------------------------------------------------------------------------------

/** "09:00–17:00" for each range; "Closed" for a closed day or one left open with no range. */
function dayText(day: HoursBlock["days"][keyof HoursBlock["days"]] | undefined): string {
  if (!day || day.closed || day.ranges.length === 0) return "Closed";
  return day.ranges.map((range) => `${range.open}–${range.close}`).join(", ");
}

/** The ranges the script reads: only valid "HH:MM-HH:MM" pairs, comma separated; empty when closed. */
function dayData(day: HoursBlock["days"][keyof HoursBlock["days"]] | undefined): string {
  if (!day || day.closed) return "";
  return day.ranges
    .filter((range) => TIME_PATTERN.test(range.open) && TIME_PATTERN.test(range.close))
    .map((range) => `${range.open}-${range.close}`)
    .join(",");
}

/**
 * Opening hours as an accessible table: a row per day (the day as a row header, then its ranges or
 * "Closed") and the note under it. The markup is the same for every visitor and every day: each row
 * carries its ranges as `data-ranges` and the block its zone as `data-tz`, and the tenant script
 * sets `aria-current="date"` on today's row and writes the status line ("Open now" or "Closed
 * now"). Without the script the table is complete and the status line is empty (hidden).
 */
export function HoursView({ block, ctx }: { block: HoursBlock; ctx: BlockContext }) {
  const { style } = blockTokens(ctx.tokens, block.overrides);
  const note = (block.note ?? "").trim();
  return (
    <section
      className="pg-hours"
      data-block-id={block.id}
      data-block-type="hours"
      data-tz={isHoursTimezone(block.timezone) ? block.timezone : "UTC"}
      style={style}
    >
      <p className="pg-hours-status" role="status" data-hours-status=""></p>
      <table className="pg-hours-table">
        <caption className="pg-hours-caption">Opening hours</caption>
        <tbody>
          {DAY_KEYS.map((key) => (
            <tr
              key={key}
              className="pg-hours-row"
              data-day={key}
              data-ranges={dayData(block.days[key])}
            >
              <th scope="row" className="pg-hours-day">
                {DAY_LABELS[key]}
              </th>
              <td className="pg-hours-times">{dayText(block.days[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note === "" ? null : <p className="pg-hours-note">{note}</p>}
    </section>
  );
}
