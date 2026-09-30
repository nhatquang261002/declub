import { Select } from "@/components/Select";
import { TraitRequestSummary } from "@/components/TraitRequest";
import type { TraitFilter } from "@/lib/traitRequests";

type Props = {
  options: readonly TraitFilter[];
  traitType: string;
  traitValue: string;
  onType: (traitType: string) => void;
  onValue: (value: string) => void;
  loading: boolean;
  /** Size and Merkle root of the set the current choice commits to. */
  count: number;
  root: string;
};

/** Trait type and value selects for a trait request, plus what the choice commits to. */
export function TraitPicker({ options, traitType, traitValue, onType, onValue, loading, count, root }: Props) {
  const types = [...new Set(options.map((o) => o.traitType))].sort();
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Anyone who holds a Chog with this trait can accept. The deal commits to the Chogs that match today.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="trait-type">Trait</label>
          <Select
            id="trait-type"
            value={traitType}
            placeholder="Choose a trait"
            options={[{ value: "", label: "Choose a trait" }, ...types.map((type) => ({ value: type, label: type }))]}
            onChange={onType}
          />
        </div>
        <div>
          <label className="label" htmlFor="trait-value">Value</label>
          <Select
            id="trait-value"
            value={traitValue}
            placeholder="Choose a value"
            disabled={!traitType || loading}
            options={[
              { value: "", label: "Choose a value" },
              ...options.filter((o) => o.traitType === traitType).map((o) => ({ value: o.value, label: o.value })),
            ]}
            onChange={onValue}
          />
        </div>
      </div>
      {loading && <p className="text-xs text-muted">Loading the catalog…</p>}
      {count > 0 && <TraitRequestSummary filter={{ traitType, value: traitValue }} count={count} root={root} />}
    </div>
  );
}
