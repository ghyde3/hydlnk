"use client";

import { LIMITS, newFaqItem, type FaqBlock, type FaqItem } from "@/lib/document";
import { TextAreaField } from "../text-field";
import { CountedField } from "./counted-field";
import { AddButton, ItemCard, ItemControls, moved } from "./list-forms";
import { OverrideControls } from "./override-controls";
import { fieldError, itemHasError, type BlockFormProps } from "./types";

/**
 * FAQ (M9-16): per question a one-line "Question" and a multi-line "Answer" (plain text: no marks,
 * no links), with Move up, Move down and Remove; "Add question" up to ten. The answers are drawn
 * closed on the page and open on a tap, with no script. Publish errors sit under the exact field and
 * the row focuses the first one (the items carry `data-item-id`).
 */
export function FaqForm({ block, onChange, errors }: BlockFormProps) {
  if (block.type !== "faq") return null;
  const faq: FaqBlock = block;
  const setItems = (items: FaqItem[]) => onChange({ ...faq, items });
  const patch = (id: string, next: Partial<FaqItem>) =>
    setItems(faq.items.map((item) => (item.id === id ? { ...item, ...next } : item)));
  const full = faq.items.length >= LIMITS.faqItemsMax;
  const listError = fieldError(errors, faq.id, "items");
  return (
    <div className="flex flex-col gap-3">
      {listError ? (
        <p data-field="items" role="alert" className="text-[13px] text-bad">
          {listError}
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {faq.items.map((item, index) => (
          <ItemCard
            key={item.id}
            label={`Question ${index + 1}`}
            itemId={item.id}
            invalid={itemHasError(errors, faq.id, item.id)}
          >
            <CountedField
              label="Question"
              field="question"
              max={LIMITS.faqQuestion}
              value={item.question}
              error={fieldError(errors, faq.id, "question", item.id)}
              onChange={(question) => patch(item.id, { question })}
            />
            <TextAreaField
              label="Answer"
              field="answer"
              max={LIMITS.faqAnswer}
              rows={4}
              value={item.answer}
              error={fieldError(errors, faq.id, "answer", item.id)}
              onChange={(answer) => patch(item.id, { answer })}
            />
            <ItemControls
              index={index}
              count={faq.items.length}
              minCount={LIMITS.faqItemsMin}
              onMove={(to) => setItems(moved(faq.items, index, to))}
              onRemove={() => setItems(faq.items.filter((it) => it.id !== item.id))}
            />
          </ItemCard>
        ))}
      </ol>
      <AddButton disabled={full} onClick={() => setItems([...faq.items, newFaqItem()])}>
        Add question
      </AddButton>
      {full ? (
        <p className="text-xs text-text-2">You can add up to {LIMITS.faqItemsMax} questions.</p>
      ) : null}
      <OverrideControls block={faq} onChange={onChange} errors={errors} />
    </div>
  );
}
