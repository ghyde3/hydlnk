import { Container, H2, SECTION_Y } from "./primitives";

const FAQ: { question: string; answer: string; open?: boolean }[] = [
  {
    question: "Is the free plan actually free?",
    answer:
      "Yes. One page, every block, the full theme system and per-link analytics — no time limit and no card on file.",
    open: true,
  },
  {
    question: "How do custom domains work?",
    answer:
      "On Pro, add a domain like links.yourbrand.com and set the one DNS record we show you. We verify it and issue SSL automatically.",
  },
  {
    question: "Do you take a cut of sales?",
    answer: "No. There are no commerce fees on any plan.",
  },
  {
    question: "What if my page gets a lot of traffic?",
    answer:
      "It keeps serving. Pages are cached at the edge and built for traffic spikes, on every plan.",
  },
];

/** #faq: four native <details> items, so click, Enter and Space all toggle without JavaScript. */
export function Faq() {
  return (
    <section id="faq" className={`bg-surface ${SECTION_Y}`}>
      <Container className="flex flex-wrap gap-[clamp(24px,6vw,64px)]">
        <div className="flex-[1_1_300px]">
          <h2 className={H2}>Questions</h2>
        </div>
        <div className="min-w-0 flex-[2_1_560px] rounded-md border border-line bg-surface">
          {FAQ.map((item) => (
            <details
              key={item.question}
              open={item.open}
              className="border-t border-line px-[18px] pt-1.5 pb-1.5 first:border-t-0 open:pb-4"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
                {item.question}
                <span aria-hidden="true" className="text-xl font-normal text-text-3">
                  +
                </span>
              </summary>
              <p className="mt-1 mb-1.5 text-[15px] leading-[1.6] text-text-2">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
