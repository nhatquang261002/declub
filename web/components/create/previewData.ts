import type { ChogMetadata } from "@/lib/metadata";
import { traitKey, type TraitCatalog } from "@/lib/traitSpec";

/**
 * Stand-ins for the wallet and the catalog when NEXT_PUBLIC_DEMO_CREATE is on, so the create
 * screens can be looked at (and screenshotted) without a wallet or a populated collection.
 */
export const PREVIEW_IDS = [1159n, 1376n, 143n, 67n, 909n];

const chog = (id: bigint, hat: string, eyes: string, background: string) => ({
  id,
  metadata: {
    name: `Chog #${id}`,
    image: null,
    attributes: [
      { trait_type: "Hat", value: hat },
      { trait_type: "Eyes", value: eyes },
      { trait_type: "Background", value: background },
    ],
  } satisfies ChogMetadata,
});

export const PREVIEW_CATALOG = [
  chog(1159n, "Crown", "Blue", "Purple"),
  chog(1376n, "Wizard Hat", "Laser", "Mint"),
  chog(143n, "Beanie", "Green", "Sunset"),
  chog(67n, "Crown", "Sleepy", "Night"),
  chog(909n, "Cowboy Hat", "Blue", "Mint"),
];

/** The same catalog as a trait scan would return it, for the V2 trait picker. */
export const PREVIEW_TRAIT_CATALOG: TraitCatalog = {
  enumerable: true,
  tokens: PREVIEW_CATALOG.map(({ id, metadata }) => ({
    id,
    keys: metadata.attributes.map((a) => traitKey({ traitType: a.trait_type, value: a.value })),
  })),
};
