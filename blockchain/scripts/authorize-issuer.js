/**
 * authorize-issuer.js
 * 
 * Authorizes a wallet address as an issuer in the CertificateRegistry contract.
 * Run this AFTER deploying the contract, using the OWNER account (Hardhat account #0).
 * 
 * Usage:
 *   npx hardhat run scripts/authorize-issuer.js --network localhost
 * 
 * Set ISSUER_ADDRESS in the script to the wallet address you want to authorize.
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// ✏️ CHANGE THIS to the MetaMask wallet address of the Head/Issuer user
const ISSUER_ADDRESS = process.env.ISSUER_ADDRESS || "";

async function main() {
    if (!ISSUER_ADDRESS || ISSUER_ADDRESS === "") {
        console.error("❌ Please set the ISSUER_ADDRESS environment variable.");
        console.error("   Example: $env:ISSUER_ADDRESS='0xYourAddress'; npx hardhat run scripts/authorize-issuer.js --network localhost");
        process.exit(1);
    }

    // Load deployment info
    const deploymentPath = path.join(__dirname, "../deployment.json");
    if (!fs.existsSync(deploymentPath)) {
        console.error("❌ deployment.json not found. Run deploy.js first.");
        process.exit(1);
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const contractAddress = deployment.contractAddress;

    console.log("📌 Contract address:", contractAddress);
    console.log("👤 Authorizing issuer:", ISSUER_ADDRESS);

    const [owner] = await hre.ethers.getSigners();
    console.log("🔑 Using owner account:", owner.address);

    const CertificateRegistry = await hre.ethers.getContractAt(
        "CertificateRegistry",
        contractAddress,
        owner
    );

    // Check if already authorized
    const isAlreadyAuthorized = await CertificateRegistry.authorizedIssuers(ISSUER_ADDRESS);
    if (isAlreadyAuthorized) {
        console.log("✅ Address is already an authorized issuer. No action needed.");
        return;
    }

    // Authorize
    const tx = await CertificateRegistry.authorizeIssuer(ISSUER_ADDRESS);
    await tx.wait();

    console.log("✅ Issuer authorized successfully!");
    console.log("   Transaction hash:", tx.hash);
}

main().catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
});
