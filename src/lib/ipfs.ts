/**
 * src/lib/ipfs.ts
 * 
 * IPFS utilities for uploading and managing certificate PDFs
 * Uses web3.storage for easy IPFS integration
 */

/**
 * Upload a file to IPFS using Pinata
 * Requires: Pinata JWT in environment
 * 
 * Prerequisites:
 * 1. Get API key (JWT) from https://app.pinata.cloud/developers/api-keys
 * 2. Set VITE_PINATA_JWT in .env
 * 
 * @param file File to upload (PDF, image, etc.)
 * @returns IPFS hash (CID)
 */
export async function uploadToIPFS(file: File): Promise<string> {
  const jwt = import.meta.env.VITE_PINATA_JWT;

  if (!jwt) {
    throw new Error(
      "Pinata JWT not found. " +
      "Please set VITE_PINATA_JWT in your .env file.\n" +
      "Get a free key at https://app.pinata.cloud"
    );
  }

  try {
    console.log("📤 Uploading to IPFS via Pinata:", file.name);

    const formData = new FormData();
    formData.append('file', file);

    const metadata = JSON.stringify({
      name: `certificate-${Date.now()}`,
    });
    formData.append('pinataMetadata', metadata);

    const options = JSON.stringify({
      cidVersion: 1,
    });
    formData.append('pinataOptions', options);

    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Failed to upload to Pinata: ${res.statusText}`);
    }

    const resData = await res.json();
    const cid = resData.IpfsHash;

    console.log("✅ Upload successful! IPFS Hash:", cid);
    return cid;
  } catch (error: any) {
    throw new Error(`IPFS upload failed: ${error.message}`);
  }
}

/**
 * Get IPFS gateway URL for a hash
 * @param ipfsHash IPFS content hash (CID)
 * @returns Full URL to access file from IPFS gateway
 */
export function getIPFSUrl(ipfsHash: string): string {
  // Using Pinata's public gateway (resolves instantly for files pinned to Pinata)
  return `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
}

/**
 * Alternative: Get IPFS URL from Pinata
 * @param ipfsHash IPFS content hash
 * @returns Pinata gateway URL
 */
export function getPinataUrl(ipfsHash: string): string {
  return `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
}

/**
 * Alternative: Get IPFS URL from Cloudflare
 * @param ipfsHash IPFS content hash
 * @returns Cloudflare IPFS gateway URL
 */
export function getCloudflareIPFSUrl(ipfsHash: string): string {
  return `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`;
}

/**
 * Validate IPFS hash format
 * @param hash IPFS hash to validate
 * @returns True if valid CID format
 */
export function isValidIPFSHash(hash: string): boolean {
  // CID v0 usually starts with Qm and is 46 chars
  // CID v1 usually starts with bafy and is 59 chars, but can vary depending on encoding
  // Just check if it's a reasonably long alphanumeric string starting with Qm or baf
  if (!hash) return false;
  return /^(Qm[a-zA-Z0-9]{44}|baf[a-zA-Z0-9]{50,60})$/.test(hash);
}
