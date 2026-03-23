import { ethers } from "ethers";
import { config } from "./config.js";

const ERC721_ABI = [
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

export interface NftMetadata {
  name: string;
  description: string;
  image: string;
  collectionName: string;
  tokenId: string;
  nftContract: string;
}

function resolveIpfsUrl(url: string): string {
  if (url.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${url.slice(7)}`;
  }
  return url;
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchNftMetadata(
  provider: ethers.JsonRpcProvider,
  nftContract: string,
  tokenId: bigint
): Promise<NftMetadata> {
  const fallback: NftMetadata = {
    name: `NFT #${tokenId.toString()}`,
    description: "",
    image: "",
    collectionName: "Unknown Collection",
    tokenId: tokenId.toString(),
    nftContract,
  };

  try {
    const siteApiUrl = `${config.site.baseUrl}/api/nft/token?contract=${nftContract}&tokenId=${tokenId.toString()}`;
    const siteRes = await fetchWithTimeout(siteApiUrl);
    if (siteRes.ok) {
      const data = (await siteRes.json()) as {
        name?: string;
        image?: string;
        description?: string;
        collectionName?: string;
      };
      if (data && (data.name || data.image)) {
        return {
          name: data.name ?? fallback.name,
          description: data.description ?? "",
          image: data.image ? resolveIpfsUrl(data.image) : "",
          collectionName: data.collectionName ?? fallback.collectionName,
          tokenId: tokenId.toString(),
          nftContract,
        };
      }
    }
  } catch {
    // fall through to on-chain fetch
  }

  try {
    const contract = new ethers.Contract(nftContract, ERC721_ABI, provider);
    const [tokenUriResult, nameResult] = await Promise.allSettled([
      contract.tokenURI(tokenId) as Promise<string>,
      contract.name() as Promise<string>,
    ]);

    if (nameResult.status === "fulfilled") {
      fallback.collectionName = nameResult.value;
    }

    if (tokenUriResult.status !== "fulfilled" || !tokenUriResult.value) {
      return fallback;
    }

    const uri = resolveIpfsUrl(tokenUriResult.value);
    const metaRes = await fetchWithTimeout(uri);
    if (!metaRes.ok) return fallback;

    const metadata = (await metaRes.json()) as {
      name?: string;
      description?: string;
      image?: string;
    };

    return {
      name: metadata.name ?? fallback.name,
      description: metadata.description ?? "",
      image: metadata.image ? resolveIpfsUrl(metadata.image) : "",
      collectionName: fallback.collectionName,
      tokenId: tokenId.toString(),
      nftContract,
    };
  } catch {
    return fallback;
  }
}

export async function fetchListingNftInfo(
  listingId: string
): Promise<{ nftContract: string; tokenId: bigint } | null> {
  try {
    const url = `${config.site.baseUrl}/api/listings/${listingId}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      nftContract?: string;
      nft_contract?: string;
      contractAddress?: string;
      tokenId?: number | string;
      token_id?: number | string;
    };
    const contract =
      data.nftContract ?? data.nft_contract ?? data.contractAddress ?? null;
    const tokenId = data.tokenId ?? data.token_id ?? null;
    if (!contract || tokenId == null) return null;
    return { nftContract: contract, tokenId: BigInt(tokenId) };
  } catch {
    return null;
  }
}
