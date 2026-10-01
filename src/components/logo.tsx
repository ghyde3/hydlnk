/** HYDLNK wordmark with the brass diamond. Renders no link; wrap it where one is needed. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span aria-hidden="true" className="inline-block size-[9px] rotate-45 bg-brass" />
      <span className="text-[15px] font-bold tracking-[0.14em]">HYDLNK</span>
    </span>
  );
}
