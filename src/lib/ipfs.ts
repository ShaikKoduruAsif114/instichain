/**
 * src/lib/ipfs.ts
 * 
 * IPFS utilities for uploading and managing certificate PDFs
 * Uses web3.storage for easy IPFS integration
 */

/**
 * Upload a file to IPFS using web3.storage
 * Requires: Web3.Storage API key in environment
 * 
 * Prerequisites:
 * 1. Install web3.storage: npm install web3.storage
 * 2. Get API key from https://web3.storage
 * 3. Set VITE_WEB3_STORAGE_KEY in .env
 * 
 * @param file File to upload (PDF, image, etc.)
 * @returns IPFS hash (CID)
 */
export async function uploadToIPFS(file: File): Promise<string> {
  const apiKey = import.meta.env.VITE_WEB3_STORAGE_KEY;
  
  if (!apiKey) {
    throw new Error(
      "Web3.Storage API key not found. " +
      "Please set VITE_WEB3_STORAGE_KEY in your .env file.\n" +
      "Get a free key at https://web3.storage"
    );
  }

  try {
    // Dynamically import web3.storage to avoid build issues
    let Web3Storage: any;
    try {
      // @ts-ignore - web3.storage is an optional dependency
      const module = await import("web3.storage");
      Web3Storage = module.Web3Storage;
    } catch (e) {
      throw new Error(
        "web3.storage module not found. Install with: npm install web3.storage"
      );
    }
    
    const client = new Web3Storage({ token: apiKey });
    
    console.log("📤 Uploading to IPFS:", file.name);
    
    // Upload file with metadata
    const cid = await client.put([file], {
      name: `certificate-${Date.now()}`,
      maxRetries: 3,
    });

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
  // Using public IPFS gateway
  return `https://w3s.link/ipfs/${ipfsHash}`;
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
  // CID v0 is 46 chars starting with Qm
  // CID v1 is longer and starts with different encoding
  return /^Qm[a-zA-Z0-9]{44}$/.test(hash) || /^bafy[a-z2-7]{55}$/.test(hash);
}
