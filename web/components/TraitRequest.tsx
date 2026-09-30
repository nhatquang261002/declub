import type { TraitFilter } from "@/lib/traitRequests";

export function TraitRequestSummary({
  filter,
  count,
  root,
}: {
  filter?: TraitFilter;
  count: bigint | number;
  root?: string;
}) {
  const label = filter ? `${filter.traitType}: ${filter.value}` : "Matching trait";
  return (
    <div className="rounded-xl border border-[#d83b45]/30 bg-[#fff4cf] p-3 text-[#111318]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm bg-[#d83b45] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-white">
          trait request
        </span>
        <span className="font-semibold">{label}</span>
      </div>
      <p className="mt-1 text-xs text-[#5d6270]">
        Any {count.toString()} matching asset{Number(count) === 1 ? "" : "s"} can satisfy this request.
      </p>
      {root && <p className="mt-1 truncate font-mono text-[10px] text-[#5d6270]">root {root}</p>}
    </div>
  );
}
