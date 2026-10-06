import Link from "next/link";
import { audienceHref } from "../audiences/data";
import { ArrowLink, SectionIntro } from "../primitives";
import { PhoneFrame } from "../demo/demo-page";
import { Carousel } from "./carousel";
import { SHOW_BRANDS } from "./data";
import { ShowPage } from "./show-page";

/**
 * The body of the home page's "See it in action" section: the intro and a carousel with one phone
 * per platform or kind of work, each showing an invented brand built from a different mix of
 * the real block types, with a link to the matching audience page. The phones wear the themes; the frame
 * around them is HYDLNK's own.
 */
export function SeeItInAction({ titleId }: { titleId: string }) {
  const total = SHOW_BRANDS.length;
  return (
    <>
      <SectionIntro
        titleId={titleId}
        title="See it in action."
        lead="Twelve setups for where people post and what they make: TikTok, Instagram, YouTube, X, music, art, a café and more. Swipe through, then make yours."
      />
      <div className="mt-10">
        <Carousel label="Demo pages, one for each platform and kind of work" total={total}>
          {SHOW_BRANDS.map((brand, index) => (
            <div
              key={brand.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${brand.role}, ${brand.theme.name} theme, ${index + 1} of ${total}`}
              tabIndex={0}
              className="sc-slide"
            >
              {/* The setup link sits on the phone's corner, so the row costs no extra height. The
                  theme and role are in the slide's accessible name above. */}
              <div className="sc-stage">
                <PhoneFrame>
                  <ShowPage brand={brand} />
                </PhoneFrame>
                <Link href={audienceHref(brand.audience)} className="sc-setup-link">
                  {brand.setup}
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          ))}
        </Carousel>
      </div>
      <p className="mt-6 text-sm text-text-2">
        Demo pages for invented brands, with photos made for this site.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-8">
        <ArrowLink href="/design-control">How themes work</ArrowLink>
        <ArrowLink href="/features">Every feature, in detail</ArrowLink>
      </div>
    </>
  );
}
