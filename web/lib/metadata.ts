import { IPFS_GATEWAY } from "./config";

type ChogMetadata = {
  name: string;
  image: string | null;
  attributes: { trait_type: string; value: string }[];
};

const resolveUri = (uri: string) => (uri.startsWith("ipfs://") ? IPFS_GATEWAY + uri.slice("ipfs://".length) : uri);

function decodeBase64Utf8(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Straight from the host, or, when the browser can't (no CORS header: scatter.art), through our
 * server, which asks the chain for the URI itself. Only collections we know the address of can fall back.
 */
async function fetchJson(url: string, tokenId: bigint, source?: { collection: string }) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`metadata ${res.status}`);
    return await res.json();
  } catch (e) {
    if (!source) throw e;
    const res = await fetch(`/api/token-metadata?collection=${source.collection}&id=${tokenId}`);
    if (!res.ok) throw new Error(`metadata ${res.status}`);
    return await res.json();
  }
}

/**
 * Reads a `tokenURI`. MockChog returns on-chain `data:application/json;base64,...`;
 * the real collection will likely point at IPFS or HTTP JSON instead.
 */
export async function loadMetadata(tokenUri: string, tokenId: bigint, source?: { collection: string }): Promise<ChogMetadata> {
  let json: Partial<ChogMetadata> & { image?: string };
  const base64Prefix = "data:application/json;base64,";
  const utf8Prefix = "data:application/json;utf8,";

  if (tokenUri.startsWith(base64Prefix)) {
    json = JSON.parse(decodeBase64Utf8(tokenUri.slice(base64Prefix.length)));
  } else if (tokenUri.startsWith(utf8Prefix)) {
    json = JSON.parse(decodeURIComponent(tokenUri.slice(utf8Prefix.length)));
  } else {
    json = await fetchJson(resolveUri(tokenUri), tokenId, source);
  }

  return {
    name: json.name ?? `Chog #${tokenId}`,
    image: json.image ? resolveUri(json.image) : null,
    attributes: Array.isArray(json.attributes) ? json.attributes : [],
  };
}
