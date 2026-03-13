/**
 * src/lib/blockchain.ts
 * 
 * Web3 utilities for interacting with CertificateRegistry smart contract
 * Provides functions to:
 * - Connect wallet
 * - Issue certificates
 * - Verify certificates
 * - Fetch student certificates
 */

import { ethers, BrowserProvider, Contract } from "ethers";

// =================== TYPES ===================

export interface Certificate {
  studentName: string;
  course: string;
  issuer: string;
  ipfsHash: string;
  issueDate: number;
  valid: boolean;
  issuerAddress: string;
}

export interface CertificateWithId extends Certificate {
  certificateId: number;
}

// =================== CONTRACT CONFIGURATION ===================

// ABI for CertificateRegistry - minimal interface with key functions
const CERTIFICATE_REGISTRY_ABI = [
  // Issue Certificate
  {
    inputs: [
      { internalType: "address", name: "_studentAddress", type: "address" },
      { internalType: "string", name: "_studentName", type: "string" },
      { internalType: "string", name: "_course", type: "string" },
      { internalType: "string", name: "_issuer", type: "string" },
      { internalType: "string", name: "_ipfsHash", type: "string" },
    ],
    name: "issueCertificate",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Batch Issue Certificates
  {
    inputs: [
      { internalType: "address[]", name: "_studentAddresses", type: "address[]" },
      { internalType: "string[]", name: "_studentNames", type: "string[]" },
      { internalType: "string[]", name: "_courses", type: "string[]" },
      { internalType: "string[]", name: "_issuers", type: "string[]" },
      { internalType: "string[]", name: "_ipfsHashes", type: "string[]" },
    ],
    name: "batchIssueCertificates",
    outputs: [{ internalType: "uint256[]", name: "", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Verify Certificate
  {
    inputs: [{ internalType: "uint256", name: "_certificateId", type: "uint256" }],
    name: "verifyCertificate",
    outputs: [
      {
        components: [
          { internalType: "string", name: "studentName", type: "string" },
          { internalType: "string", name: "course", type: "string" },
          { internalType: "string", name: "issuer", type: "string" },
          { internalType: "string", name: "ipfsHash", type: "string" },
          { internalType: "uint256", name: "issueDate", type: "uint256" },
          { internalType: "bool", name: "valid", type: "bool" },
          { internalType: "address", name: "issuerAddress", type: "address" },
        ],
        internalType: "struct CertificateRegistry.Certificate",
        name: "certificate",
        type: "tuple",
      },
      { internalType: "bool", name: "isValid", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  // Get Certificates by Owner
  {
    inputs: [{ internalType: "address", name: "_studentAddress", type: "address" }],
    name: "getCertificatesByOwner",
    outputs: [{ internalType: "uint256[]", name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  // Get Certificate Details
  {
    inputs: [{ internalType: "uint256", name: "_certificateId", type: "uint256" }],
    name: "getCertificate",
    outputs: [
      {
        components: [
          { internalType: "string", name: "studentName", type: "string" },
          { internalType: "string", name: "course", type: "string" },
          { internalType: "string", name: "issuer", type: "string" },
          { internalType: "string", name: "ipfsHash", type: "string" },
          { internalType: "uint256", name: "issueDate", type: "uint256" },
          { internalType: "bool", name: "valid", type: "bool" },
          { internalType: "address", name: "issuerAddress", type: "address" },
        ],
        internalType: "struct CertificateRegistry.Certificate",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // Revoke Certificate
  {
    inputs: [{ internalType: "uint256", name: "_certificateId", type: "uint256" }],
    name: "revokeCertificate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Get Total Token Count
  {
    inputs: [],
    name: "getTotalTokenCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Authorize Issuer (onlyOwner)
  {
    inputs: [
      { internalType: "address", name: "_issuer", type: "address" },
      { internalType: "string", name: "_adminName", type: "string" },
      { internalType: "string", name: "_clubName", type: "string" }
    ],
    name: "authorizeIssuer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Remove Issuer (onlyOwner)
  {
    inputs: [{ internalType: "address", name: "_issuer", type: "address" }],
    name: "removeIssuer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Verify Admin Token
  {
    inputs: [{ internalType: "uint256", name: "_tokenId", type: "uint256" }],
    name: "verifyAdminToken",
    outputs: [
      {
        components: [
          { internalType: "string", name: "adminName", type: "string" },
          { internalType: "string", name: "clubName", type: "string" },
          { internalType: "uint256", name: "issueDate", type: "uint256" },
          { internalType: "bool", name: "valid", type: "bool" }
        ],
        internalType: "struct CertificateRegistry.AdminToken",
        name: "adminToken",
        type: "tuple"
      },
      { internalType: "bool", name: "isValid", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  // Verify Admin By Wallet
  {
    inputs: [{ internalType: "address", name: "_issuer", type: "address" }],
    name: "verifyAdminByWallet",
    outputs: [
      {
        components: [
          { internalType: "string", name: "adminName", type: "string" },
          { internalType: "string", name: "clubName", type: "string" },
          { internalType: "uint256", name: "issueDate", type: "uint256" },
          { internalType: "bool", name: "valid", type: "bool" }
        ],
        internalType: "struct CertificateRegistry.AdminToken",
        name: "adminToken",
        type: "tuple"
      },
      { internalType: "bool", name: "isValid", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  }
];


// Contract address - loaded from deployment file or environment
let CONTRACT_ADDRESS: string | null = null;

// =================== INITIALIZATION ===================

/**
 * Initialize contract address from deployment file
 * This is called automatically when module loads
 */
async function initializeContractAddress() {
  if (CONTRACT_ADDRESS) return;

  try {
    const response = await fetch("/contract-deployment.json");
    if (response.ok) {
      const data = await response.json();
      CONTRACT_ADDRESS = data.contractAddress;
      console.log("✅ Contract address loaded:", CONTRACT_ADDRESS);
    } else {
      console.warn("⚠️ contract-deployment.json not found. Deploy the contract first.");
    }
  } catch (error) {
    console.error("Error loading contract address:", error);
  }
}

// Initialize on module load
initializeContractAddress();

// =================== WALLET CONNECTION ===================

/**
 * Connect to MetaMask wallet
 * @returns Object with provider, signer, and connected address
 */
export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask not installed. Please install MetaMask to continue.");
  }

  try {
    // Request account access
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    }) as string[];

    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts found");
    }

    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = accounts[0];

    // Verify we're on the local Hardhat network (chain ID 31337)
    const network = await provider.getNetwork();
    if (network.chainId !== 31337n) {
      console.warn("⚠️ You are not on the Hardhat local network. Please switch networks.");
      // Attempt to switch network
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x7A69" }], // 31337 in hex
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          // Network not added, attempt to add it
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x7A69",
                chainName: "Hardhat Localhost",
                rpcUrls: ["http://127.0.0.1:8545"],
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              },
            ],
          });
        }
      }
    }

    return {
      provider,
      signer,
      address,
    };
  } catch (error: any) {
    throw new Error(`Wallet connection failed: ${error.message}`);
  }
}

/**
 * Get current wallet address
 * @returns Wallet address or null if not connected
 */
export async function getCurrentWalletAddress(): Promise<string | null> {
  if (!window.ethereum) return null;

  try {
    const provider = new BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    return await signer.getAddress();
  } catch {
    return null;
  }
}

// =================== CONTRACT INTERACTION ===================

/**
 * Get contract instance
 * @param signer Ethers signer for write operations (optional)
 * @returns Contract instance
 */
export async function getContract(signer?: any) {
  if (!CONTRACT_ADDRESS) {
    await initializeContractAddress();
  }

  if (!CONTRACT_ADDRESS) {
    throw new Error(
      "Contract address not found. Please deploy the smart contract first."
    );
  }

  const provider = new BrowserProvider(window.ethereum);
  const instance = signer
    ? new Contract(CONTRACT_ADDRESS, CERTIFICATE_REGISTRY_ABI, signer)
    : new Contract(CONTRACT_ADDRESS, CERTIFICATE_REGISTRY_ABI, provider);

  return instance;
}

/**
 * Issue a new certificate to a student
 * @param studentAddress Address of the student
 * @param studentName Full name of the student
 * @param course Course name
 * @param issuer Issuing institution name
 * @param ipfsHash IPFS hash of certificate PDF
 * @returns Certificate ID
 */
export async function issueCertificate(
  studentAddress: string,
  studentName: string,
  course: string,
  issuer: string,
  ipfsHash: string
): Promise<number> {
  try {
    const { signer } = await connectWallet();
    const contract = await getContract(signer);

    const tx = await contract.issueCertificate(
      studentAddress,
      studentName,
      course,
      issuer,
      ipfsHash
    );

    console.log("📝 Transaction sent:", tx.hash);

    const receipt = await tx.wait();
    console.log("✅ Certificate issued! Block:", receipt?.blockNumber);

    // Extract certificate ID from transaction logs
    const event = receipt?.logs.find((log: any) =>
      log.topics[0] === ethers.id("CertificateIssued(uint256,address,string,string,string,string,uint256)")
    );

    if (event) {
      // Certificate ID is in the first topic parameter
      const certificateId = parseInt(event.topics[1], 16);
      return certificateId;
    }

    // Fallback: query total count
    const totalCount = await contract.getTotalTokenCount();
    return Number(totalCount) - 1;
  } catch (error: any) {
    throw new Error(`Failed to issue certificate: ${error.message}`);
  }
}

/**
 * Issue multiple certificates in a single transaction
 * @param studentAddresses Array of student addresses
 * @param studentNames Array of student names
 * @param courses Array of course names
 * @param issuers Array of issuer names
 * @param ipfsHashes Array of IPFS hashes
 * @returns Array of Certificate IDs
 */
export async function batchIssueCertificates(
  studentAddresses: string[],
  studentNames: string[],
  courses: string[],
  issuers: string[],
  ipfsHashes: string[]
): Promise<number[]> {
  try {
    const { signer } = await connectWallet();
    const contract = await getContract(signer);

    const tx = await contract.batchIssueCertificates(
      studentAddresses,
      studentNames,
      courses,
      issuers,
      ipfsHashes
    );

    console.log("📝 Batch transaction sent:", tx.hash);

    const receipt = await tx.wait();
    console.log("✅ Batch certificates issued! Block:", receipt?.blockNumber);

    const events = receipt?.logs.filter((log: any) =>
      log.topics[0] === ethers.id("CertificateIssued(uint256,address,string,string,string,string,uint256)")
    );

    if (events && events.length > 0) {
      return events.map((e: any) => parseInt(e.topics[1], 16));
    }

    return [];
  } catch (error: any) {
    throw new Error(`Failed to batch issue certificates: ${error.message}`);
  }
}

/**
 * Verify a certificate
 * @param certificateId ID of the certificate to verify
 * @returns Certificate data and validity status
 */
export async function verifyCertificate(
  certificateId: number
): Promise<{ certificate: Certificate; isValid: boolean }> {
  try {
    const contract = await getContract();
    const result = await contract.verifyCertificate(certificateId);

    return {
      certificate: {
        studentName: result[0].studentName,
        course: result[0].course,
        issuer: result[0].issuer,
        ipfsHash: result[0].ipfsHash,
        issueDate: Number(result[0].issueDate),
        valid: result[0].valid,
        issuerAddress: result[0].issuerAddress,
      },
      isValid: result[1],
    };
  } catch (error: any) {
    throw new Error(`Failed to verify certificate: ${error.message}`);
  }
}

/**
 * Get all certificates for a student
 * @param studentAddress Address of the student
 * @returns Array of certificate IDs
 */
export async function getCertificatesByOwner(
  studentAddress: string
): Promise<number[]> {
  try {
    const contract = await getContract();
    const certIds = await contract.getCertificatesByOwner(studentAddress);
    return certIds.map((id: any) => Number(id));
  } catch (error: any) {
    throw new Error(`Failed to fetch certificates: ${error.message}`);
  }
}

/**
 * Get certificate details by ID
 * @param certificateId ID of the certificate
 * @returns Certificate metadata
 */
export async function getCertificateDetails(certificateId: number): Promise<Certificate> {
  try {
    const contract = await getContract();
    const cert = await contract.getCertificate(certificateId);

    return {
      studentName: cert.studentName,
      course: cert.course,
      issuer: cert.issuer,
      ipfsHash: cert.ipfsHash,
      issueDate: Number(cert.issueDate),
      valid: cert.valid,
      issuerAddress: cert.issuerAddress,
    };
  } catch (error: any) {
    throw new Error(`Failed to get certificate details: ${error.message}`);
  }
}

/**
 * Get all student certificates with details
 * @param studentAddress Address of the student
 * @returns Array of certificates with IDs
 */
export async function getStudentCertificates(
  studentAddress: string
): Promise<CertificateWithId[]> {
  try {
    const certIds = await getCertificatesByOwner(studentAddress);
    const certificates: CertificateWithId[] = [];

    for (const id of certIds) {
      const cert = await getCertificateDetails(id);
      certificates.push({ ...cert, certificateId: id });
    }

    return certificates;
  } catch (error: any) {
    throw new Error(`Failed to fetch student certificates: ${error.message}`);
  }
}

/**
 * Revoke a certificate
 * Only the issuer or contract owner can revoke
 * @param certificateId ID of the certificate to revoke
 */
export async function revokeCertificate(certificateId: number): Promise<void> {
  try {
    const { signer } = await connectWallet();
    const contract = await getContract(signer);

    const tx = await contract.revokeCertificate(certificateId);
    console.log("🔄 Revocation transaction sent:", tx.hash);

    await tx.wait();
    console.log("✅ Certificate revoked!");
  } catch (error: any) {
    throw new Error(`Failed to revoke certificate: ${error.message}`);
  }
}

/**
 * Get total number of certificates issued
 * @returns Total certificate count
 */
export async function getTotalTokenCount(): Promise<number> {
  try {
    const contract = await getContract();
    const count = await contract.getTotalTokenCount();
    return Number(count);
  } catch (error: any) {
    throw new Error(`Failed to get token count: ${error.message}`);
  }
}

// Export contract address for debugging
export function getContractAddress(): string | null {
  return CONTRACT_ADDRESS;
}

/**
 * Authorize a wallet address as a certificate issuer on-chain and mint them an Admin NFT.
 * Must be called by the contract owner (Hardhat Account #0 / deployer).
 * @param issuerAddress Wallet address to authorize
 * @param adminName Name of the admin
 * @param clubName Name of the club
 */
export async function authorizeIssuerOnChain(issuerAddress: string, adminName: string, clubName: string): Promise<void> {
  try {
    const { signer } = await connectWallet();
    const contract = await getContract(signer);
    const tx = await contract.authorizeIssuer(issuerAddress, adminName, clubName);
    console.log("📝 Authorize issuer tx:", tx.hash);
    await tx.wait();
    console.log(`✅ ${issuerAddress} is now an authorized issuer with an Admin NFT`);
  } catch (error: any) {
    throw new Error(`Failed to authorize issuer: ${error.message}`);
  }
}

/**
 * Remove issuer authorization from a wallet address and revoke their Admin NFT.
 * Must be called by the contract owner.
 * @param issuerAddress Wallet address to de-authorize
 */
export async function removeIssuerOnChain(issuerAddress: string): Promise<void> {
  try {
    const { signer } = await connectWallet();
    const contract = await getContract(signer);
    const tx = await contract.removeIssuer(issuerAddress);
    console.log("📝 Remove issuer tx:", tx.hash);
    await tx.wait();
    console.log(`✅ ${issuerAddress} is no longer an authorized issuer`);
  } catch (error: any) {
    throw new Error(`Failed to remove issuer: ${error.message}`);
  }
}

export interface AdminToken {
  adminName: string;
  clubName: string;
  issueDate: number;
  valid: boolean;
}

/**
 * Verify an Admin by their wallet address
 */
export async function verifyAdminByWallet(issuerAddress: string): Promise<{ adminToken: AdminToken; isValid: boolean }> {
  try {
    const contract = await getContract();
    const result = await contract.verifyAdminByWallet(issuerAddress);
    return {
      adminToken: {
        adminName: result[0].adminName,
        clubName: result[0].clubName,
        issueDate: Number(result[0].issueDate),
        valid: result[0].valid
      },
      isValid: result[1]
    };
  } catch (error: any) {
    throw new Error(`Failed to verify admin: ${error.message}`);
  }
}

// =================== VERIFICATION HASH UTILS ===================

/**
 * Generate a hex-encoded verification payload
 * @param type "cert" or "admin"
 * @param value certificate ID or wallet address
 * @returns Hex string like "0x434552543..."
 */
export function generateVerificationHash(type: "cert" | "admin", value: string | number): string {
  const payload = `${type.toUpperCase()}:${value}`;
  // Convert basic string to hex
  let hex = "0x";
  for (let i = 0; i < payload.length; i++) {
    hex += payload.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Decode a hex-encoded verification payload
 * @param hex The encoded hex string
 * @returns Object with type ("cert" or "admin") and value, or null if invalid
 */
export function decodeVerificationHash(hex: string): { type: "cert" | "admin"; value: string } | null {
  try {
    if (!hex.startsWith("0x")) return null;
    let payload = "";
    for (let i = 2; i < hex.length; i += 2) {
      payload += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    const [type, value] = payload.split(":");
    if ((type === "CERT" || type === "ADMIN") && value) {
      return { type: type.toLowerCase() as "cert" | "admin", value };
    }
    return null;
  } catch {
    return null;
  }
}
