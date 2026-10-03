"use client";

import { useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { chog } from "@/lib/contracts";
import { loadMetadata } from "@/lib/metadata";

type OnchainTraits = readonly [string, string, string];

function traitAttributes(traits: OnchainTraits | undefined) {
  if (!traits) return [];
  return [
    { trait_type: "Hat", value: traits[0] },
    { trait_type: "Eyes", value: traits[1] },
    { trait_type: "Background", value: traits[2] },
  ];
}

/** Name, image and traits from tokenURI. Token metadata never changes, so cache forever. */
export function useChogMetadata(id: bigint) {
  const traits = useReadContract({
    ...chog,
    functionName: "traitsOf",
    args: [id],
    query: { staleTime: Infinity, retry: 1 },
  });
  const uri = useReadContract({
    ...chog,
    functionName: "tokenURI",
    args: [id],
    query: { staleTime: Infinity, retry: 1 },
  });

  const metadata = useQuery({
    queryKey: ["chogMetadata", chog.address, id.toString(), uri.data],
    queryFn: () => loadMetadata(uri.data!, id),
    enabled: !!uri.data,
    staleTime: Infinity,
  });

  const onchainAttributes = traitAttributes(traits.data as OnchainTraits | undefined);
  return {
    metadata: metadata.data
      ? { ...metadata.data, attributes: onchainAttributes.length > 0 ? onchainAttributes : metadata.data.attributes }
      : traits.data
        ? { name: `Chog #${id}`, image: null, attributes: onchainAttributes }
        : undefined,
    isLoading: traits.isLoading || uri.isLoading || metadata.isLoading,
  };
}
