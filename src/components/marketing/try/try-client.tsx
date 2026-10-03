"use client";

import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { BLOCK_CATALOG } from "../block-catalog";
import { ButtonLink } from "../primitives";
import { signupUrl } from "../signup-handoff";
import {
  PREVIEW_HINT,
  TRY_BLOCK_KINDS,
  TRY_MAX_BLOCKS,
  blockName,
  blockSummary,
  buildTryDoc,
  type TryPreset,
} from "./sample-page";
import {
  ACCENT_IDS,
  ACCENT_LABELS,
  BACKGROUND_IDS,
  BACKGROUND_LABELS,
  FONT_PAIR_IDS,
  FONT_PAIRS,
  SHAPE_IDS,
  SHAPE_LABELS,
  TRY_THEMES,
  accentColors,
  tryTheme,
  type BackgroundId,
  type FontPairId,
  type ShapeId,
} from "./themes";
import { initialTryState, tryReducer } from "./try-state";
import { TryLayout, TryPhone } from "./try-phone";
import { fontStack } from "./fonts";

/**
 * The interactive try-it builder: a live phone preview of a sample page, a theme to tap, a few
 * plain style choices, and the nine blocks to add, move and remove. Everything lives in this
 * component's state: nothing is saved or sent. The page it draws is the real page renderer's.
 */

const TABS = [
  { id: "themes", label: "Themes" },
  { id: "style", label: "Style" },
  { id: "blocks", label: "Blocks" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** One radio button drawn as a chip. Native radios: arrow keys and screen readers work as they should. */
function Choice({
  name,
  value,
  checked,
  onSelect,
  className = "",
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`try-choice ${className}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {children}
    </label>
  );
}

function Chevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5 fill-none stroke-current stroke-[2]"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "up" ? "M6 14.5l6-6 6 6" : "M6 9.5l6 6 6-6"} />
    </svg>
  );
}

function Cross() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-5 fill-none stroke-current stroke-[2]"
      strokeLinecap="round"
    >
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}

const ICONS = new Map(BLOCK_CATALOG.map((block) => [block.id, block.icon]));

/** What an Image block does here, said once, where the card is. */
const CARD_NOTES: Record<string, string> = {
  image: "Shows a placeholder here. You upload your own photo in the editor.",
};

export default function TryBuilder({
  preset,
  rootDomain,
}: {
  preset?: TryPreset;
  rootDomain: string;
}) {
  const options = preset ?? {};
  const [state, dispatch] = useReducer(tryReducer, options, initialTryState);
  const [tab, setTab] = useState<TabId>("themes");
  const group = useId();
  const nameId = `${group}-name`;
  const screenRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const blocksRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);

  // Tests (and anything that waits for the controls to work) look for this flag.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.setAttribute("data-try-ready", "true");
  }, []);

  const theme = tryTheme(state.themeId);
  const swatches = accentColors(theme);
  const doc = useMemo(
    () => buildTryDoc(state, options),
    // `options` is the prop object: it never changes for a mounted builder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.themeId, state.style, state.name, state.blocks],
  );
  const full = state.blocks.length >= TRY_MAX_BLOCKS;
  const ctaHref = signupUrl(rootDomain, state.name);

  // A block just added: show it in the phone. Scrolls the phone's own screen, never the page.
  useEffect(() => {
    const screen = screenRef.current;
    if (!state.lastAddedId || !screen) return;
    const target = screen.querySelector(`[data-block-id="${state.lastAddedId}"]`);
    if (!target) return;
    const offset =
      target.getBoundingClientRect().top - screen.getBoundingClientRect().top + screen.scrollTop;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    screen.scrollTo({ top: Math.max(0, offset - 72), behavior: reduced ? "auto" : "smooth" });
  }, [state.lastAddedId, state.blocks]);

  // After a remove, keep keyboard focus in the list instead of dropping it on the page.
  useEffect(() => {
    const wanted = pendingFocus.current;
    if (wanted === null) return;
    pendingFocus.current = null;
    const next =
      wanted === ""
        ? null
        : blocksRef.current?.querySelector<HTMLElement>(`[data-try-remove="${wanted}"]`);
    // With no block left to land on, the "On your page" label takes focus.
    (next ?? blocksRef.current?.querySelector<HTMLElement>("[data-try-rows-label]"))?.focus();
  }, [state.blocks]);

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    const index = TABS.findIndex((item) => item.id === tab);
    let next = -1;
    if (event.key in keys) next = (index + keys[event.key]! + TABS.length) % TABS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TABS.length - 1;
    if (next === -1) return;
    event.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    tabRefs.current[id]?.focus();
  }

  function removeBlock(id: string, index: number) {
    const neighbor = state.blocks[index + 1] ?? state.blocks[index - 1];
    pendingFocus.current = neighbor?.id ?? "";
    dispatch({ type: "remove", id });
  }

  const caption = (
    <p className="try-status" role="status" data-testid="try-status">
      {state.status || PREVIEW_HINT}
    </p>
  );

  const panel = (
    <>
      <div>
        <label htmlFor={nameId} className="try-label">
          Your name
          <span className="try-value">shows on the page as you type</span>
        </label>
        <input
          id={nameId}
          type="text"
          className="try-input"
          value={state.name}
          maxLength={40}
          placeholder={options.name ?? "Jordan Ellis"}
          autoComplete="off"
          onChange={(event) => dispatch({ type: "name", value: event.target.value })}
        />
      </div>

      <div
        role="tablist"
        aria-label="What to change"
        className="try-tabs"
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[item.id] = element;
            }}
            type="button"
            role="tab"
            id={`${group}-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`${group}-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className="try-tab"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${group}-panel-themes`}
        aria-labelledby={`${group}-tab-themes`}
        hidden={tab !== "themes"}
        className="try-tabpanel"
      >
        <fieldset className="try-fieldset">
          <legend className="try-label">Pick a theme</legend>
          <div className="try-choices" data-cols="3">
            {TRY_THEMES.map((item) => (
              <Choice
                key={item.id}
                name={`${group}-theme`}
                value={item.id}
                checked={state.themeId === item.id}
                onSelect={() => dispatch({ type: "theme", id: item.id })}
              >
                <span
                  aria-hidden="true"
                  className="try-theme-swatch"
                  style={
                    {
                      background: item.tokens.bg,
                      "--try-swatch-accent": item.tokens.accent,
                    } as CSSProperties
                  }
                />
                {item.name}
              </Choice>
            ))}
          </div>
        </fieldset>
        <p className="try-hint">
          Every theme is free, and you can keep changing the colors, fonts and shapes after you
          pick one.
        </p>
      </div>

      <div
        role="tabpanel"
        id={`${group}-panel-style`}
        aria-labelledby={`${group}-tab-style`}
        hidden={tab !== "style"}
        className="try-tabpanel"
      >
        <fieldset className="try-fieldset">
          <legend className="try-label">
            Accent color
            <span className="try-value">
              {state.style.accent ? ACCENT_LABELS[state.style.accent] : "Default"}
            </span>
          </legend>
          <div className="try-choices" data-swatches="">
            <Choice
              name={`${group}-accent`}
              value="theme"
              checked={state.style.accent === null}
              onSelect={() => dispatch({ type: "accent", value: null })}
            >
              Default
            </Choice>
            {ACCENT_IDS.map((id) => (
              <Choice
                key={id}
                name={`${group}-accent`}
                value={id}
                checked={state.style.accent === id}
                onSelect={() => dispatch({ type: "accent", value: id })}
                className="try-accent"
              >
                <span className="sr-only">{ACCENT_LABELS[id]}</span>
                <span
                  aria-hidden="true"
                  className="try-accent-chip"
                  style={{ background: swatches[id] }}
                />
              </Choice>
            ))}
          </div>
        </fieldset>

        <fieldset className="try-fieldset">
          <legend className="try-label">Fonts</legend>
          <div className="try-choices">
            {FONT_PAIR_IDS.map((id: FontPairId) => (
              <Choice
                key={id}
                name={`${group}-fonts`}
                value={id}
                checked={state.style.fonts === id}
                onSelect={() => dispatch({ type: "fonts", value: id })}
              >
                {id === "theme" ? (
                  "Default"
                ) : (
                  <span style={{ fontFamily: fontStack(FONT_PAIRS[id].heading) }}>
                    {FONT_PAIRS[id].label}
                  </span>
                )}
              </Choice>
            ))}
          </div>
        </fieldset>

        <fieldset className="try-fieldset">
          <legend className="try-label">Buttons</legend>
          <div className="try-choices">
            {SHAPE_IDS.map((id: ShapeId) => (
              <Choice
                key={id}
                name={`${group}-shape`}
                value={id}
                checked={state.style.shape === id}
                onSelect={() => dispatch({ type: "shape", value: id })}
              >
                {id === "theme" ? "Default" : SHAPE_LABELS[id]}
              </Choice>
            ))}
          </div>
        </fieldset>

        <fieldset className="try-fieldset">
          <legend className="try-label">Background</legend>
          <div className="try-choices">
            {BACKGROUND_IDS.map((id: BackgroundId) => (
              <Choice
                key={id}
                name={`${group}-background`}
                value={id}
                checked={state.style.background === id}
                onSelect={() => dispatch({ type: "background", value: id })}
              >
                {id === "theme" ? "Default" : BACKGROUND_LABELS[id]}
              </Choice>
            ))}
          </div>
        </fieldset>
      </div>

      <div
        role="tabpanel"
        id={`${group}-panel-blocks`}
        aria-labelledby={`${group}-tab-blocks`}
        hidden={tab !== "blocks"}
        className="try-tabpanel"
      >
        <div>
          <p className="try-label">Tap a block to add it</p>
          <ul className="try-add-grid">
            {TRY_BLOCK_KINDS.map((kind) => {
              const info = BLOCK_CATALOG.find((block) => block.id === kind);
              return (
                <li key={kind}>
                  <button
                    type="button"
                    className="try-add"
                    aria-disabled={full ? "true" : undefined}
                    data-try-add={kind}
                    onClick={() => dispatch({ type: "add", kind })}
                  >
                    <span className="try-add-icon" aria-hidden="true">
                      {ICONS.get(kind)}
                    </span>
                    <span>
                      <span className="try-add-name">
                        <span className="sr-only">Add </span>
                        {info?.name ?? kind}
                      </span>
                      <span className="try-add-short">
                        {CARD_NOTES[kind] ?? info?.short}
                      </span>
                    </span>
                    <span className="try-add-plus" aria-hidden="true">
                      +
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div ref={blocksRef}>
          <p className="try-label" tabIndex={-1} data-try-rows-label="">
            On your page
            <span className="try-value" data-testid="try-count">
              {state.blocks.length} of {TRY_MAX_BLOCKS}
            </span>
          </p>
          {state.blocks.length === 0 ? (
            <p className="try-empty">Nothing here yet. Tap a block above to add one.</p>
          ) : (
            <ol className="try-rows" aria-label="Blocks on your page">
              {state.blocks.map((block, index) => {
                const name = blockName(block);
                const summary = blockSummary(block);
                const label = `${name}, ${summary}`;
                return (
                  <li key={block.id} className="try-row" data-try-row={block.id}>
                    <span className="try-row-text">
                      <span className="try-row-name">{name}</span>
                      <span className="try-row-sum">{summary}</span>
                    </span>
                    <button
                      type="button"
                      className="try-icon-button"
                      aria-label={`Move up: ${label}`}
                      aria-disabled={index === 0 ? "true" : undefined}
                      data-try-up={block.id}
                      onClick={() => dispatch({ type: "move", id: block.id, direction: -1 })}
                    >
                      <Chevron direction="up" />
                    </button>
                    <button
                      type="button"
                      className="try-icon-button"
                      aria-label={`Move down: ${label}`}
                      aria-disabled={index === state.blocks.length - 1 ? "true" : undefined}
                      data-try-down={block.id}
                      onClick={() => dispatch({ type: "move", id: block.id, direction: 1 })}
                    >
                      <Chevron direction="down" />
                    </button>
                    <button
                      type="button"
                      className="try-icon-button"
                      aria-label={`Remove: ${label}`}
                      data-try-remove={block.id}
                      onClick={() => removeBlock(block.id, index)}
                    >
                      <Cross />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      <div className="try-cta">
        <p className="text-base font-semibold">Like it?</p>
        <ButtonLink href={ctaHref}>Claim your name to keep building</ButtonLink>
        <button type="button" className="try-reset" onClick={() => dispatch({ type: "reset" })}>
          Start over
        </button>
        <p className="try-hint basis-full">Nothing here is saved. Free forever, no card needed.</p>
      </div>
    </>
  );

  return (
    <div ref={rootRef} data-testid="try-builder">
      <TryLayout
        phone={<TryPhone doc={doc} screenRef={screenRef} />}
        caption={caption}
        panel={panel}
      />
    </div>
  );
}
