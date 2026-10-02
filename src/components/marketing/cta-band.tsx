import { clientEnv } from "@/lib/env/client";
import { ClaimForm } from "./claim-form";
import { Container } from "./primitives";

/** Closing charcoal band with the claim form in its dark variant. One per page. */
export function CtaBand({
  title = "Claim your name before someone else does.",
  note = "Free forever. Upgrade only when you want your own domain.",
  formId = "cta-handle",
}: {
  title?: string;
  note?: string;
  formId?: string;
}) {
  return (
    <section
      aria-labelledby={`${formId}-title`}
      className="bg-ink py-[clamp(56px,12vw,96px)] text-on-ink"
    >
      <Container className="flex flex-col items-center text-center">
        <h2
          id={`${formId}-title`}
          className="max-w-[760px] text-[clamp(30px,7vw,48px)] leading-[1.1] font-bold tracking-[-0.03em]"
        >
          {title}
        </h2>
        <div className="mt-8 flex w-full justify-center">
          <ClaimForm id={formId} rootDomain={clientEnv.NEXT_PUBLIC_ROOT_DOMAIN} variant="dark" />
        </div>
        <p className="mt-3.5 text-[13px] text-on-ink-muted">{note}</p>
      </Container>
    </section>
  );
}
