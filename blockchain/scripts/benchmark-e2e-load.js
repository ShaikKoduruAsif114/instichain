/**
 * benchmark-e2e-load.js
 *
 * Controlled end-to-end workload: issue + verify synthetic credential
 * datasets of 100 / 500 / 1000 certificates.
 *
 * For each scale it measures (from receipts/timers — never estimates):
 *   - issuance success rate, total time, total gas, gas per certificate
 *   - full-verification pass: success rate, total time, per-cert verify time
 *   - revocation pass on a 5% sample (status transition correctness)
 *
 * ENVIRONMENT LABEL: local Hardhat in-process network. This is a controlled
 * benchmark of contract-layer throughput; it does NOT model production
 * network latency, mempool contention, or real user concurrency.
 *
 * Output: benchmarks/e2e-load.json
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtSgPgvodDkJZj2oG6MqX";
const SCALES = [100, 500, 1000];
const MAX_BATCH = 50;

async function issueDataset(registry, owner, count) {
  const ids = [];
  let gas = 0n;
  let txCount = 0;
  const start = Date.now();

  let remaining = count;
  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_BATCH);
    remaining -= chunk;
    const addrs = Array.from({ length: chunk }, () => ethers.Wallet.createRandom().address);
    const names = Array.from({ length: chunk }, (_, i) => `Student ${ids.length + i}`);
    const courses = Array.from({ length: chunk }, () => "Load Test Credential");
    const issuers = Array.from({ length: chunk }, () => "InstiChain Institute");
    const cids = Array.from({ length: chunk }, () => CID);

    const tx = await registry
      .connect(owner)
      .batchIssueCertificates(addrs, names, courses, issuers, cids);
    const rcpt = await tx.wait();
    txCount++;
    if (rcpt.status !== 1) throw new Error("batch issuance reverted during load test");
    gas += rcpt.gasUsed;
    for (const log of rcpt.logs) {
      try {
        const parsed = registry.interface.parseLog(log);
        if (parsed && parsed.name === "CertificateIssued") ids.push(parsed.args.certificateId);
      } catch {
        /* skip */
      }
    }
  }
  const ms = Date.now() - start;
  return { ids, gas, txCount, ms };
}

async function main() {
  const { ethers } = hre;
  const [owner] = await ethers.getSigners();

  console.log("Deploying registry…");
  const Factory = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Factory.deploy();
  await registry.waitForDeployment();

  const results = [];

  for (const scale of SCALES) {
    console.log(`\n=== scale ${scale} ===`);

    // ---------- issuance ----------
    const { ids, gas, txCount, ms } = await issueDataset(registry, owner, scale);
    const totalTokens = await registry.getTotalTokenCount();
    const issued = {
      certificates: ids.length,
      transactions: txCount,
      totalTimeMs: ms,
      totalGas: Number(gas),
      gasPerCertificate: +(Number(gas) / ids.length).toFixed(2),
      issuanceSuccessRate: ids.length === scale ? 1.0 : ids.length / scale,
      throughputCertsPerSec: +((ids.length / ms) * 1000).toFixed(1),
    };
    console.log(
      `issued ${ids.length}/${scale} in ${(ms / 1000).toFixed(2)}s, ` +
        `${issued.gasPerCertificate} gas/cert, ${issued.throughputCertsPerSec} certs/s`
    );

    // ---------- verification (every certificate) ----------
    const vStart = Date.now();
    let vOk = 0;
    let vBad = 0;
    for (const id of ids) {
      const [, status] = await registry.verifyCertificate(id);
      if (status === 1n) vOk++;
      else vBad++;
    }
    const vMs = Date.now() - vStart;
    const verified = {
      attempts: ids.length,
      successCount: vOk,
      failureCount: vBad,
      successRate: +(vOk / ids.length).toFixed(4),
      totalTimeMs: vMs,
      perCertificateMs: +(vMs / ids.length).toFixed(3),
    };
    console.log(
      `verified ${vOk}/${ids.length} in ${(vMs / 1000).toFixed(2)}s ` +
        `(${verified.perCertificateMs} ms/cert)`
    );

    // ---------- revocation on a 5% sample ----------
    const sample = ids.filter((_, i) => i % 20 === 0);
    const rStart = Date.now();
    let rOk = 0;
    for (const id of sample) {
      const tx = await registry.connect(owner).revokeCertificate(id);
      const rcpt = await tx.wait();
      if (rcpt.status === 1) rOk++;
      const [, status] = await registry.verifyCertificate(id);
      if (status !== 2n) throw new Error(`certificate ${id} did not read REVOKED after revoke`);
    }
    const rMs = Date.now() - rStart;
    const revoked = {
      sampled: sample.length,
      successCount: rOk,
      successRate: +(rOk / sample.length).toFixed(4),
      totalTimeMs: rMs,
      postRevokeStatusCheck: "all sampled certificates read REVOKED (status=2)",
    };
    console.log(`revoked ${rOk}/${sample.length} sampled certs, all verified REVOKED`);

    results.push({ scale, issued, verified, revoked });
  }

  const outDir = path.join(__dirname, "..", "..", "benchmarks");
  fs.mkdirSync(outDir, { recursive: true });

  const meta = {
    benchmark: "instichain-e2e-load",
    version: 1,
    measuredAt: new Date().toISOString(),
    environment: "local Hardhat in-process network — controlled benchmark, NOT production scale",
    network: hre.network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    maxBatchSize: MAX_BATCH,
    method:
      "batch issuance (50/tx) + full verification pass + 5% revocation sample; " +
      "gas from receipts; timing via Date.now()",
    results,
  };

  const jsonPath = path.join(outDir, "e2e-load.json");
  fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
  console.log(`\n✅ JSON → ${jsonPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
