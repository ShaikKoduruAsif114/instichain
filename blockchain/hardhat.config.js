/**
 * Hardhat configuration for InstiChain CertificateRegistry
 */
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      initialBaseFeePerGas: 0,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    polygonAmoy: {
      url: process.env.AMOY_RPC || "https://rpc-amoy.polygon.technology",
      accounts,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC || "https://sepolia.gateway.tenderly.co",
      accounts,
    },
  },
  mocha: {
    timeout: 120000,
  },
};
