const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying CertificateRegistry contract...");

  try {
    // Get the contract factory
    const CertificateRegistry = await hre.ethers.getContractFactory("CertificateRegistry");

    // Deploy the contract
    console.log("📝 Deploying to network:", hre.network.name);
    const contract = await CertificateRegistry.deploy();

    // Wait for deployment to complete
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    console.log("✅ CertificateRegistry deployed successfully!");
    console.log("📌 Contract Address:", contractAddress);

    // Save contract address and ABI to a JSON file for frontend use
    const deploymentInfo = {
      network: hre.network.name,
      contractAddress: contractAddress,
      deployedAt: new Date().toISOString(),
      abi: CertificateRegistry.interface.formatJson(),
    };

    const deploymentPath = path.join(__dirname, "../deployment.json");
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    console.log("📄 Deployment info saved to:", deploymentPath);

    // Also save to frontend public folder for easy access
    const frontendPath = path.join(__dirname, "../../public/contract-deployment.json");
    fs.writeFileSync(frontendPath, JSON.stringify(deploymentInfo, null, 2));
    console.log("📄 Deployment info also saved to frontend public folder");

  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exitCode = 1;
  }
}

main();
