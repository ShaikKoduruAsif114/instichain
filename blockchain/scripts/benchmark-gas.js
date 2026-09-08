/**
 * benchmark-gas.js
 *
 * Measures ACTUAL gas consumed (from transaction receipts — never estimates)
 * for certificate issuance:
 *
 *   A. N individual `issueCertificate` transactions
 *   B. ceil(N / MAX_BATCH_SIZE) `batchIssueCertificates` transactions
 *
 * Batch sizes: 1, 10, 25, 50, 100, 200
 *
 * Output:
 *   benchmarks/gas-benchmark.json  (machine-readable)
 *   benchmarks/gas-benchmark.csv   (spreadsheet-friendly)
 *
 * Run:  npx hardhat run scripts/benchmark-gas.js
 * (uses the in-process Hardhat network by default; add --network localhost
 *  to run against a local node)
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtSgPgvodDkJZj2oG6MqX"; // 46-char CIDv0
const SIZES = [1, 10, 25, 50, 100, 200];

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const { ethers } = hre;
  const [owner] = await ethers.getSigners();

  console.log("Deploying CertificateRegistry…");
  const Factory = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Factory.deploy();
  await registry.waitForDeployment();
  console.log("Registry at", await registry.getAddress());

  const results = [];
  let certCursor = 0;

  for (const size of SIZES) {
    // ---------- A. Individual issuance ----------
    const individualReceipts = [];
    const tIndivStart = Date.now();
    for (let i = 0; i < size; i++) {
      const student = ethers.Wallet.createRandom().address;
      const tx = await registry
        .connect(owner)
        .issueCertificate(student, `Student ${i}`, "Course", "InstiChain", CID);
      const rcpt = await tx.wait();
      individualReceipts.push(rcpt);
    }
    const tIndivMs = Date.now() - tIndivStart;

    const individualTotalGas = individualReceipts.reduce(
      (acc, r) => acc + r.gasUsed,
      0n
    );

    // ---------- B. Batch issuance ----------
    const batchReceipts = [];
    const tBatchStart = Date.now();
    // MAX_BATCH_SIZE is 50 (see contract), so larger sizes need multiple txs.
    const maxBatch = Number(await registry.MAX_BATCH_SIZE());
    let remaining = size;
    while (remaining > 0) {
      const chunk = Math.min(remaining, maxBatch);
      remaining -= chunk;
      const addrs = Array.from({ length: chunk }, () =>
        ethers.Wallet.createRandom().address
      );
      const names = Array.from({ length: chunk }, (_, i) => `Student ${i}`);
      const courses = Array.from({ length: chunk }, () => "Course");
      const issuers = Array.from({ length: chunk }, () => "InstiChain");
      const cids = Array.from({ length: chunk }, () => CID);

      const tx = await registry
        .connect(owner)
        .batchIssueCertificates(addrs, names, courses, issuers, cids);
      const rcpt = await tx.wait();
      batchReceipts.push(rcpt);
    }
    const tBatchMs = Date.now() - tBatchStart;

    const batchTotalGas = batchReceipts.reduce((acc, r) => acc + r.gasUsed, 0n);

    const indivNum = Number(individualTotalGas);
    const batchNum = Number(batchTotalGas);

    results.push({
      batchSize: size,
      individual: {
        transactionCount: individualReceipts.length,
        totalGas: indivNum,
        gasPerCertificate: indivNum / size,
        executionTimeMs: tIndivMs,
        avgTimePerTxMs: tIndivMs / individualReceipts.length,
        success: individualReceipts.every((r) => r.status === 1),
      },
      batch: {
        transactionCount: batchReceipts.length,
        totalGas: batchNum,
        gasPerCertificate: batchNum / size,
        executionTimeMs: tBatchMs,
        success: batchReceipts.every((r) => r.status === 1),
      },
      comparison: {
        absoluteGasSavings: indivNum - batchNum,
        percentageGasSavings:
          indivNum > 0 ? 1 - batchNum / indivNum : 0,
      },
    });

    console.log(
      `size=${size}  individual=${indivNum} gas (${indivNum / size}/cert)  ` +
        `batch=${batchNum} gas (${batchNum / size}/cert)  ` +
        `savings=${(
          (1 - batchNum / indivNum) * 100
        ).toFixed(1)}%`
    );

    certCursor += size;
  }

  // ---------- Outputs ----------
  const outDir = path.join(__dirname, "..", "..", "benchmarks");
  fs.mkdirSync(outDir, { recursive: true });

  const meta = {
    benchmark: "instichain-gas-individual-vs-batch",
    version: 1,
    measuredAt: nowIso(),
    network: hre.network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    solidity: "0.8.28 (cancun, optimizer 200 runs)",
    hardhatVersion: require("hardhat/package.json").version,
    openzeppelinVersion:
      require("@openzeppelin/contracts/package.json").version,
    gasPriceBasis: "gasUsed from transaction receipts (measured, not estimated)",
    contractAddress: await registry.getAddress(),
    certificatesIssued: certCursor,
    note:
      "Hardhat in-process network has zero base fee; these are GAS units, " +
      "which are network-independent. Execution times are local-machine " +
      "and not representative of public-network latency.",
    results,
  };

  const jsonPath = path.join(outDir, "gas-benchmark.json");
  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));

  const csvRows = [
    "batch_size,individual_tx_count,individual_total_gas,individual_gas_per_cert,individual_time_ms,batch_tx_count,batch_total_gas,batch_gas_per_cert,batch_time_ms,absolute_gas_savings,percentage_gas_savings",
  ];
  for (const r of results) {
    csvRows.push(
      [
        r.batchSize,
        r.individual.transactionCount,
        r.individual.totalGas,
        r.individual.gasPerCertificate.toFixed(2),
        r.individual.executionTimeMs,
        r.batch.transactionCount,
        r.batch.totalGas,
        r.batch.gasPerCertificate.toFixed(2),
        r.batch.executionTimeMs,
        r.comparison.absoluteGasSavings,
        (r.comparison.percentageGasSavings * 100).toFixed(2) + "%",
      ].join(",")
    );
  }
  const csvPath = path.join(outDir, "gas-benchmark.csv");
  fs.writeFileSync(csvPath, csvRows.join("\n") + "\n");

  console.log(`\n✅ JSON → ${jsonPath}`);
  console.log(`✅ CSV  → ${csvPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
