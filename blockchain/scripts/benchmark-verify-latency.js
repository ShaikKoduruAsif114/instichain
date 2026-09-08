/**
 * benchmark-verify-latency.js
 *
 * Measures ACTUAL verification latency on the in-process Hardhat network.
 *
 * Method:
 *   1. Build a realistic dataset: 1,000 certificates issued via 20 batch
 *      transactions of 50 (the on-chain MAX_BATCH_SIZE).
 *   2. For each sample size (100 / 500 / 1000 verifications), call
 *      verifyCertificate on deterministic certificate IDs and record every
 *      per-call latency with process.hrtime.bigtime precision.
 *
 * Separation of concerns:
 *   - blockchainLookupMs : raw `eth_call` RPC round-trip (no decoding)
 *   - fullVerifyMs       : contract.verifyCertificate (RPC + ABI decoding)
 *   - appProcessingMs    : full − lookup  (ethers.js decode/overhead)
 *
 * Output:
 *   benchmarks/verify-latency.json
 *
 * ENVIRONMENT LABEL: local Hardhat in-process network. These numbers measure
 * node + ABI overhead, NOT production Internet latency to a public RPC.
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtSgPgvodDkJZj2oG6MqX";
const SAMPLE_SIZES = [100, 500, 1000];
const DATASET_SIZE = 1000;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    count: samples.length,
    meanMs: +(sum / samples.length).toFixed(3),
    minMs: +sorted[0].toFixed(3),
    maxMs: +sorted[sorted.length - 1].toFixed(3),
    p50Ms: +percentile(sorted, 50).toFixed(3),
    p90Ms: +percentile(sorted, 90).toFixed(3),
    p95Ms: +percentile(sorted, 95).toFixed(3),
    p99Ms: +percentile(sorted, 99).toFixed(3),
  };
}

async function main() {
  const { ethers } = hre;
  const [owner] = await ethers.getSigners();

  console.log("Deploying registry…");
  const Factory = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Factory.deploy();
  await registry.waitForDeployment();

  // ---------- 1. Build the dataset ----------
  console.log(`Issuing ${DATASET_SIZE} certificates (batches of 50)…`);
  const issuedIds = [];
  const tIssueStart = Date.now();
  let issueGas = 0n;
  for (let b = 0; b < DATASET_SIZE / 50; b++) {
    const addrs = Array.from({ length: 50 }, () => ethers.Wallet.createRandom().address);
    const names = Array.from({ length: 50 }, (_, i) => `Student ${b * 50 + i}`);
    const courses = Array.from({ length: 50 }, () => "Blockchain Engineering");
    const issuers = Array.from({ length: 50 }, () => "InstiChain Institute");
    const cids = Array.from({ length: 50 }, () => CID);
    const tx = await registry
      .connect(owner)
      .batchIssueCertificates(addrs, names, courses, issuers, cids);
    const rcpt = await tx.wait();
    issueGas += rcpt.gasUsed;
    for (const log of rcpt.logs) {
      try {
        const parsed = registry.interface.parseLog(log);
        if (parsed && parsed.name === "CertificateIssued") {
          issuedIds.push(parsed.args.certificateId);
        }
      } catch {
        /* non-CertificateIssued log */
      }
    }
  }
  const tIssueMs = Date.now() - tIssueStart;
  console.log(
    `Issued ${issuedIds.length} certs in ${(tIssueMs / 1000).toFixed(2)}s, ` +
      `${Number(issueGas)} gas total`
  );

  // ---------- 2. Verification latency ----------
  const results = [];
  for (const size of SAMPLE_SIZES) {
    const lookupSamples = [];
    const fullSamples = [];
    let success = 0;
    let failures = 0;

    for (let i = 0; i < size; i++) {
      // Deterministic ID selection: spread across the whole dataset
      const certId = issuedIds[Math.floor((i * issuedIds.length) / size)];

      // (a) raw eth_call — blockchain lookup only, no ABI decoding
      const calldata = registry.interface.encodeFunctionData("verifyCertificate", [certId]);
      const t0 = process.hrtime.bigint();
      await ethers.provider.call({
        to: await registry.getAddress(),
        data: calldata,
      });
      const t1 = process.hrtime.bigint();

      // (b) full contract call — RPC + decode + struct materialization
      const [, status] = await registry.verifyCertificate(certId);
      const t2 = process.hrtime.bigint();

      if (status === 1n) success++;
      else failures++;

      lookupSamples.push(Number(t1 - t0) / 1e6);
      fullSamples.push(Number(t2 - t0) / 1e6);
    }

    const lookup = stats(lookupSamples);
    const full = stats(fullSamples);
    results.push({
      sampleSize: size,
      expectedStatus: "VALID",
      successCount: success,
      failureCount: failures,
      successRate: +(success / size).toFixed(4),
      blockchainLookup: lookup,
      fullVerification: full,
      appProcessingMeanMs: +(full.meanMs - lookup.meanMs).toFixed(3),
    });

    console.log(
      `verify n=${size}: mean ${full.meanMs}ms p95 ${full.p95Ms}ms ` +
        `(lookup ${lookup.meanMs}ms + app ${results[results.length - 1].appProcessingMeanMs}ms) ` +
        `success ${(success / size * 100).toFixed(1)}%`
    );
  }

  // ---------- 3. Output ----------
  const outDir = path.join(__dirname, "..", "..", "benchmarks");
  fs.mkdirSync(outDir, { recursive: true });

  const meta = {
    benchmark: "instichain-verification-latency",
    version: 1,
    measuredAt: new Date().toISOString(),
    environment: "local Hardhat in-process network (NOT production Internet latency)",
    network: hre.network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    datasetSize: DATASET_SIZE,
    datasetIssuance: {
      totalTimeMs: tIssueMs,
      totalGas: Number(issueGas),
      gasPerCertificate: Number(issueGas) / DATASET_SIZE,
      batchCount: DATASET_SIZE / 50,
    },
    method:
      "per-call latency via process.hrtime.bigint(); blockchain lookup = raw " +
      "eth_call; full verification = ethers contract.verifyCertificate; " +
      "app processing = difference (ABI decode + struct materialization)",
    results,
  };

  const jsonPath = path.join(outDir, "verify-latency.json");
  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
  console.log(`\n✅ JSON → ${jsonPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
