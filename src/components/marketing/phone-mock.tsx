import { Instrument_Serif } from "next/font/google";

// Instrument Serif is a tenant theme font: it appears only inside this mock, never in the HYDLNK UI.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const SERIF = instrumentSerif.className;

/**
 * Decorative sample of a published tenant page (Mara Okafor, Noir). Its colors are tenant theme
 * values, not HYDLNK tokens. It is hidden from assistive tech and holds no links, buttons or tab
 * stops. 290 x 600 charcoal bezel.
 */
export function PhoneMock() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto mt-2.5 h-[600px] w-[290px] rounded-[40px] border border-line-3 bg-ink p-[9px]"
    >
      <div className="flex h-full flex-col items-center gap-2.5 overflow-hidden rounded-[32px] bg-[#16120E] px-[18px] pt-[34px] pb-[18px] text-[#EFE8DC]">
        <div
          className={`${SERIF} flex size-[60px] items-center justify-center rounded-[50%] border border-[#C9A86A] bg-[#C9A86A]/[0.16] text-[22px] text-[#C9A86A]`}
        >
          MO
        </div>
        <div className={`${SERIF} mt-1 text-[25px] leading-[1.1]`}>Mara Okafor</div>
        <div className="text-[11.5px] text-[#A79E90]">Portrait &amp; studio photographer</div>
        <div className="mt-1 mb-1.5 flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="inline-block size-[26px] rounded-[50%] border border-[#3A342D]"
            />
          ))}
        </div>
        <div className="w-full rounded-[12px] bg-[#C9A86A] px-3.5 py-3 text-center text-[12.5px] font-semibold text-[#15110B]">
          Portrait sessions — fall dates
        </div>
        <div className="w-full rounded-[12px] border border-[#C9A86A] px-3.5 py-3 text-center text-[12.5px]">
          Studio rental by the hour
        </div>
        <div className="w-full rounded-[12px] border border-[#C9A86A] px-3.5 py-3 text-center text-[12.5px]">
          Prints &amp; archive
        </div>
        <div className="mt-1 w-full overflow-hidden rounded-[12px] border border-[#3A342D]">
          <div className="flex h-[90px] items-end bg-[#221B13] px-3.5 py-3">
            <span className={`${SERIF} text-[28px] leading-none text-[#C9A86A] italic`}>
              Night Market
            </span>
          </div>
          <div className="px-3.5 py-2.5 text-[11.5px] text-[#A79E90]">
            New series — view the gallery
          </div>
        </div>
      </div>
    </div>
  );
}
