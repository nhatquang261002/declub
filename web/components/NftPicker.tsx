"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { Alert } from "@/components/Alert";
import { useBrowseTokenIds, useCollectionInfo, useCollectionInfos, useOwnedTokenIds, useTokenOwner, useTokenViews } from "@/hooks/useCollection";
import { useMarketCollections } from "@/hooks/useMarketCollections";
import { collectionLabel, featuredCollections, isFeatured, type CollectionInfo } from "@/lib/collections";
import { useRecentCollections } from "@/hooks/useRecentCollections";
import { CopyAddress } from "@/components/CopyAddress";

const PAGE = 12;
const OWNED_STEP = 24;
const MAX_SUGGESTIONS = 12;

export type NftPickerProps = {
  /** The wallet whose NFTs are offered. Omit to browse a collection (the "you want" side). */
  owner?: Address;
  /** Start inside this collection instead of the search. */
  collection?: Address;
  /** How many more NFTs fit on this side. */
  room: number;
  /** `collection:id` (lowercase) of NFTs already on this side, shown as added. */
  taken: ReadonlySet<string>;
  onConfirm: (collection: Address, ids: bigint[]) => void;
  onClose: () => void;
};

const tokenKey = (collection: string, id: bigint) => `${collection.toLowerCase()}:${id}`;

/**
 * Pick NFTs without copying addresses and ids: search the collections people use (or paste a
 * contract address), then tick tokens from a grid. A wallet's own NFTs are listed when the
 * collection can enumerate them; otherwise the id is typed and checked against the chain.
 */
export function NftPicker({ owner, collection: initial, room, taken, onConfirm, onClose }: NftPickerProps) {
  const [collection, setCollection] = useState<Address | null>(initial ?? null);
  const [selected, setSelected] = useState<bigint[]>([]);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const toggle = (id: bigint) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length < room ? [...current, id] : current));

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Choose NFTs"
        className="page-section flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto p-5 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{collection ? "Choose NFTs" : "Choose a collection"}</h2>
            <p className="mt-1 text-xs text-muted">
              {owner ? "Pick from your wallet." : "Pick the NFTs you want in return."} Names come from each contract, so check the address.
            </p>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {collection ? (
          <TokenStep
            collection={collection}
            owner={owner}
            room={room}
            taken={taken}
            selected={selected}
            onToggle={toggle}
            onChangeCollection={() => {
              setCollection(null);
              setSelected([]);
            }}
            onConfirm={() => onConfirm(collection, selected)}
          />
        ) : (
          <CollectionStep onSelect={setCollection} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── Step 1: the collection

function CollectionStep({ onSelect }: { onSelect: (address: Address) => void }) {
  const [query, setQuery] = useState("");
  const market = useMarketCollections();
  const recents = useRecentCollections();
  const text = query.trim();
  const pasted = isAddress(text) ? getAddress(text) : null;

  // Featured first, then what you used lately, then what open deals use. One list, no repeats.
  const sources = useMemo(() => {
    const out = new Map<string, "Featured" | "Recent" | "In open deals">();
    featuredCollections().forEach((a) => out.set(a.toLowerCase(), "Featured"));
    recents.forEach((a) => !out.has(a.toLowerCase()) && out.set(a.toLowerCase(), "Recent"));
    market.forEach((a) => !out.has(a.toLowerCase()) && out.set(a.toLowerCase(), "In open deals"));
    return out;
  }, [market, recents]);
  const candidates = useMemo(() => [...sources.keys()].map((a) => getAddress(a)), [sources]);
  const { infos, isLoading } = useCollectionInfos(candidates);

  const q = text.toLowerCase();
  const matches = candidates
    .filter((a) => {
      const info = infos.get(a.toLowerCase());
      // Contracts that don't answer as an ERC-721 (an ERC-20 seen in a deal, say) aren't collections.
      if (info && !info.isErc721) return false;
      return !q || a.toLowerCase().includes(q) || `${info?.name ?? ""} ${info?.symbol ?? ""}`.toLowerCase().includes(q);
    })
    .slice(0, MAX_SUGGESTIONS);

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="collection-search">Search collections, or paste a contract address</label>
        <input
          id="collection-search"
          autoFocus
          className="input"
          placeholder="Name, symbol or 0x…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {pasted ? (
        <PastedCollection address={pasted} onSelect={onSelect} />
      ) : (
        <>
          {text.startsWith("0x") && <p className="text-sm text-muted">Keep typing: a contract address is 42 characters.</p>}
          {isLoading && matches.length === 0 ? (
            <p className="text-sm text-muted">Loading collections…</p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted">
              {text ? "No collection matches. Paste its contract address to look it up." : "No collections to suggest yet. Paste a contract address."}
            </p>
          ) : (
            <ul className="space-y-2">
              {matches.map((a) => (
                <CollectionRow key={a} address={a} info={infos.get(a.toLowerCase())} tag={sources.get(a.toLowerCase())} onSelect={() => onSelect(a)} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CollectionRow({ address, info, tag, onSelect }: { address: Address; info?: CollectionInfo; tag?: string; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border-[1.5px] border-[#111318]/20 bg-white/70 px-3 py-2.5 text-left transition-colors hover:border-[#111318] hover:bg-white"
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold">{collectionLabel(info, "Unnamed collection")}</span>
          <CopyAddress address={address} inLink className="block text-xs text-muted" />
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {info?.totalSupply != null && <span>{info.totalSupply.toString()} items</span>}
          {tag && <span className="rounded-full border border-line px-2 py-0.5">{tag}</span>}
        </span>
      </button>
    </li>
  );
}

/** A pasted address, resolved on-chain before it can be chosen. */
function PastedCollection({ address, onSelect }: { address: Address; onSelect: (address: Address) => void }) {
  const { info, isLoading } = useCollectionInfo(address);
  if (isLoading || !info) return <p className="text-sm text-muted">Reading the contract…</p>;
  if (!info.isErc721) {
    return (
      <Alert tone="danger" title="Not an NFT collection">
        <CopyAddress address={address} /> doesn&apos;t answer as an ERC-721 collection. Check the address and the network.
      </Alert>
    );
  }
  return (
    <ul className="space-y-2">
      <CollectionRow address={address} info={info} tag={isFeatured(address) ? "Featured" : "Not in the list"} onSelect={() => onSelect(address)} />
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────── Step 2: the tokens

function TokenStep({
  collection,
  owner,
  room,
  taken,
  selected,
  onToggle,
  onChangeCollection,
  onConfirm,
}: {
  collection: Address;
  owner?: Address;
  room: number;
  taken: ReadonlySet<string>;
  selected: readonly bigint[];
  onToggle: (id: bigint) => void;
  onChangeCollection: () => void;
  onConfirm: () => void;
}) {
  const { info } = useCollectionInfo(collection);
  const enumerable = !!info?.enumerable;
  const mine = !!owner;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-[1.5px] border-[#111318]/15 bg-white/70 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate font-semibold">{collectionLabel(info, "Collection")}</span>
          <CopyAddress address={collection} className="block text-xs text-muted" />
        </span>
        <button type="button" className="btn-secondary btn-sm" onClick={onChangeCollection}>
          Change collection
        </button>
      </div>

      {info && !info.isErc721 ? (
        <Alert tone="danger" title="Not an NFT collection">
          That contract isn&apos;t an ERC-721 collection. Change the collection.
        </Alert>
      ) : mine ? (
        <OwnedGrid collection={collection} owner={owner} enumerable={enumerable} taken={taken} selected={selected} onToggle={onToggle} room={room} />
      ) : (
        <BrowseGrid collection={collection} enumerable={enumerable} supply={info?.totalSupply ?? null} taken={taken} selected={selected} onToggle={onToggle} room={room} />
      )}

      {info?.isErc721 && <ManualId collection={collection} owner={owner} taken={taken} selected={selected} room={room} onAdd={onToggle} />}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/50 pt-4">
        <span className="text-sm text-muted">
          {selected.length === 0 ? "Nothing selected" : `${selected.length} selected`}
          {room < 10 && ` · room for ${room}`}
        </span>
        <button type="button" className="btn-primary" disabled={selected.length === 0} onClick={onConfirm}>
          {selected.length <= 1 ? "Add NFT" : `Add ${selected.length} NFTs`}
        </button>
      </div>
    </div>
  );
}

type GridProps = {
  collection: Address;
  enumerable: boolean;
  taken: ReadonlySet<string>;
  selected: readonly bigint[];
  onToggle: (id: bigint) => void;
  room: number;
};

function OwnedGrid({ collection, owner, enumerable, taken, selected, onToggle, room }: GridProps & { owner: Address }) {
  const { ids, total, isLoading } = useOwnedTokenIds(collection, owner, enumerable);
  const [shown, setShown] = useState(OWNED_STEP);
  const views = useTokenViews(collection, ids.slice(0, shown));

  if (!enumerable) {
    return <p className="text-sm text-muted">This collection can&apos;t list your NFTs. Enter the token id below and it is checked against your wallet.</p>;
  }
  if (isLoading) return <p className="text-sm text-muted">Loading your NFTs…</p>;
  if (total === 0) return <p className="text-sm text-muted">You don&apos;t hold any NFTs in this collection. Pick another collection.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Your NFTs ({total}){total > ids.length && ` · showing the first ${ids.length}. Enter other ids below.`}
      </p>
      <TileGrid>
        {ids.slice(0, shown).map((id) => (
          <Tile key={id.toString()} id={id} view={views.get(id.toString())} taken={taken.has(tokenKey(collection, id))} selected={selected.includes(id)} full={selected.length >= room} onClick={() => onToggle(id)} />
        ))}
      </TileGrid>
      {ids.length > shown && (
        <button type="button" className="btn-secondary btn-sm" onClick={() => setShown(shown + OWNED_STEP)}>
          Show more
        </button>
      )}
    </div>
  );
}

function BrowseGrid({ collection, enumerable, supply, taken, selected, onToggle, room }: GridProps & { supply: bigint | null }) {
  const [page, setPage] = useState(0);
  const { ids, isLoading } = useBrowseTokenIds(collection, enumerable, supply, page, PAGE);
  const views = useTokenViews(collection, ids, true);
  const pages = supply === null ? 1 : Math.max(1, Math.ceil(Number(supply) / PAGE));

  if (!enumerable) {
    return <p className="text-sm text-muted">This collection can&apos;t be browsed. Enter the token id below and it is checked on-chain.</p>;
  }
  if (isLoading && ids.length === 0) return <p className="text-sm text-muted">Loading the collection…</p>;
  if (ids.length === 0) return <p className="text-sm text-muted">Nothing minted in this collection yet.</p>;

  return (
    <div className="space-y-3">
      <TileGrid>
        {ids.map((id) => (
          <Tile
            key={id.toString()}
            id={id}
            view={views.get(id.toString())}
            caption={views.get(id.toString())?.owner ? <>held by <CopyAddress address={views.get(id.toString())!.owner!} inLink /></> : undefined}
            taken={taken.has(tokenKey(collection, id))}
            selected={selected.includes(id)}
            full={selected.length >= room}
            onClick={() => onToggle(id)}
          />
        ))}
      </TileGrid>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <button type="button" className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="text-muted">Page {page + 1} of {pages}</span>
          <button type="button" className="btn-secondary btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

const TileGrid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">{children}</div>
);

function Tile({
  id,
  view,
  caption,
  taken,
  selected,
  full,
  onClick,
}: {
  id: bigint;
  view?: { name: string | null; image: string | null };
  caption?: React.ReactNode;
  taken: boolean;
  selected: boolean;
  full: boolean;
  onClick: () => void;
}) {
  const disabled = taken || (!selected && full);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title={view?.name ?? `#${id}`}
      className={`flex flex-col overflow-hidden rounded-lg border-2 text-left transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${
        selected ? "border-accent outline-2 outline-accent" : "border-[#111318]"
      }`}
    >
      <span className="relative block aspect-square bg-panel-2">
        {view?.image ? (
          // Arbitrary hosts from token metadata, so next/image's domain list doesn't apply.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full place-items-center font-mono text-xs text-muted">#{id.toString()}</span>
        )}
        {selected && <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-black text-white">✓</span>}
      </span>
      <span className="px-1.5 py-1 text-[11px] leading-tight">
        <span className="block truncate font-semibold">{taken ? "Added" : `#${id.toString()}`}</span>
        {caption && <span className="block truncate font-mono text-[10px] text-muted">{caption}</span>}
      </span>
    </button>
  );
}

/** For ids the grid doesn't show: typed, then checked on-chain before it can be added. */
function ManualId({
  collection,
  owner,
  taken,
  selected,
  room,
  onAdd,
}: {
  collection: Address;
  owner?: Address;
  taken: ReadonlySet<string>;
  selected: readonly bigint[];
  room: number;
  onAdd: (id: bigint) => void;
}) {
  const [text, setText] = useState("");
  const id = /^\d{1,30}$/.test(text.trim()) ? BigInt(text.trim()) : null;
  const check = useTokenOwner(collection, id);
  const views = useTokenViews(collection, id !== null && check.exists ? [id] : []);

  const mine = !owner || (!!check.owner && check.owner.toLowerCase() === owner.toLowerCase());
  const already = id !== null && (taken.has(tokenKey(collection, id)) || selected.includes(id));
  const problem =
    id === null
      ? null
      : check.isLoading
        ? "Checking…"
        : !check.exists
          ? "That token doesn't exist in this collection."
          : !mine
            ? "Your wallet doesn't own this token."
            : already
              ? "Already added."
              : selected.length >= room
                ? "No room for more on this side."
                : null;
  const ok = id !== null && !check.isLoading && check.exists && mine && !problem;
  const view = id !== null ? views.get(id.toString()) : undefined;

  return (
    <div className="space-y-1.5">
      <label className="label" htmlFor="manual-id">Or enter a token id</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="manual-id"
          className="input w-40"
          inputMode="numeric"
          placeholder="Token id"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary"
          disabled={!ok}
          onClick={() => {
            onAdd(id!);
            setText("");
          }}
        >
          Add
        </button>
        {ok && (
          <span className="text-xs text-mint">
            {view?.name ?? `#${id}`}
            {!owner && check.owner && <> · held by <CopyAddress address={check.owner} /></>}
          </span>
        )}
        {id !== null && problem && <span className={`text-xs ${problem === "Checking…" ? "text-muted" : "text-warn"}`}>{problem}</span>}
      </div>
    </div>
  );
}
