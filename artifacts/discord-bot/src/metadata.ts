import { ethers } from "ethers";

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
  collectionSymbol: string;
  tokenId: string;
  nftAddress: string;
}

function resolveIpfsUrl(url: string): string {
  if (url.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${url.slice(7)}`;
  }
  return url;
}

export async function fetchNftMetadata(
  provider: ethers.JsonRpcProvider,
  nftAddress: string,
  tokenId: bigint
): Promise<NftMetadata> {
  const fallback: NftMetadata = {
    name: `NFT #${tokenId.toString()}`,
    description: "",
    image: "",
    collectionName: "Unknown Collection",
    collectionSymbol: "",
    tokenId: tokenId.toString(),
    nftAddress,
  };

  try {
    const contract = new ethers.Contract(nftAddress, ERC721_ABI, provider);

    const [tokenUri, collectionName, collectionSymbol] = await Promise.allSettled([
      contract.tokenURI(tokenId) as Promise<string>,
      contract.name() as Promise<string>,
      contract.symbol() as Promise<string>,
    ]);

    fallback.collectionName =
      collectionName.status === "fulfilled" ? collectionName.value : "Unknown Collection";
    fallback.collectionSymbol =
      collectionSymbol.status === "fulfilled" ? collectionSymbol.value : "";

    if (tokenUri.status !== "fulfilled" || !tokenUri.value) {
      return fallback;
    }

    const uri = resolveIpfsUrl(tokenUri.value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let metadataRaw: Response;
    try {
      metadataRaw = await fetch(uri, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!metadataRaw.ok) return fallback;

    const metadata = (await metadataRaw.json()) as {
      name?: string;
      description?: string;
      image?: string;
    };

    return {
      name: metadata.name ?? fallback.name,
      description: metadata.description ?? "",
      image: metadata.image ? resolveIpfsUrl(metadata.image) : "",
      collectionName: fallback.collectionName,
      collectionSymbol: fallback.collectionSymbol,
      tokenId: tokenId.toString(),
      nftAddress,
    };
  } catch {
    return fallback;
  }
}
