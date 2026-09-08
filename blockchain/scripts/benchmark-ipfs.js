/**
 * benchmark-ipfs.js
 *
 * IPFS upload/retrieval benchmark via the Pinata HTTP API — the same
 * integration the frontend uses (src/lib/ipfs.ts → pinFileToIPFS).
 *
 * What it measures when credentials ARE available:
 *   - upload latency + success rate per document size (trials per size)
 *   - retrieval (gateway fetch) latency + success rate
 *
 * What it does when credentials are NOT available:
 *   - validates the payload-preparation pipeline locally (files, sizes,
 *     timing) and records every network metric as `blocked`, with the exact
 *     environment variable needed to run it for real.
 *
 * It NEVER fabricates network numbers.
 *
 * Run:  PINATA_JWT=<jwt> node scripts/benchmark-ipfs.js
 *   (also accepts VITE_PINATA_JWT for convenience)
 */

const fs = require("fs");
const path = require("path");

const JWT = process.env.PINATA_JWT || process.env.VITE_PINATA_JWT || "";
const TRIALS_PER_SIZE = 5;
const SIZES = [
  { label: "certificate-pdf-small", bytes: 120 * 1024 }, // ~120 KB text-heavy PDF
  { label: "certificate-pdf-typical", bytes: 350 * 1024 }, // ~350 KB with graphics
  { label: "certificate-pdf-rich", bytes: 900 * 1024 }, // ~900 KB scanned-style
];
const PINATA_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const GATEWAY = "https://gateway.pinata.cloud/ipfs/";
const UPLOAD_TIMEOUT_MS = 30000;

function makePdfLikeBuffer(bytes) {
  // A buffer that starts like a PDF and is padded to the target size.
  const header = Buffer.from("%PDF-1.4\n% InstiChain benchmark payload\n");
  const buf = Buffer.alloc(bytes);
  header.copy(buf, 0);
  // deterministic pseudo-random filler (reproducible runs)
  let x = 123456789;
  for (let i = header.length; i < bytes; i++) {
    x = (1103515245 * x + 12345) % 2147483648;
    buf[i] = x & 0xff;
  }
  return buf;
}

async function uploadOnce(buffer, label) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), `${label}.pdf`);
  form.append("pinataMetadata", JSON.stringify({ name: `instichain-bench-${label}` }));
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const t0 = performance.now();
  const res = await fetch(PINATA_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}` },
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  const ms = performance.now() - t0;
  if (!res.ok) {
    throw new Error(`Pinata responded ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return { ms, cid: data.IpfsHash };
}

async function retrieveOnce(cid) {
  const t0 = performance.now();
  const res = await fetch(GATEWAY + cid, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  const ms = performance.now() - t0;
  if (!res.ok) throw new Error(`gateway responded ${res.status}`);
  const body = await res.arrayBuffer();
  return { ms, bytes: body.byteLength };
}

function summarize(latencies, successes, attempts) {
  if (latencies.length === 0) return { attempts, successes, successRate: successes / attempts, note: "no successful trials" };
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    attempts,
    successes,
    successRate: +(successes / attempts).toFixed(4),
    meanMs: +(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1),
    p50Ms: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
    p95Ms: +sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)].toFixed(1),
  };
}

async function main() {
  const results = {
    benchmark: "instichain-ipfs-pipeline",
    version: 1,
    measuredAt: new Date().toISOString(),
    credentialsProvided: JWT !== "",
    endpoint: PINATA_ENDPOINT,
    gateway: GATEWAY,
    trialsPerSize: TRIALS_PER_SIZE,
    sizes: [],
  };

  if (!JWT) {
    // ---- Local pipeline validation only; network metrics = blocked ----
    for (const size of SIZES) {
      const t0 = performance.now();
      const buf = makePdfLikeBuffer(size.bytes);
      const prepMs = +(performance.now() - t0).toFixed(2);
      results.sizes.push({
        label: size.label,
        bytes: size.bytes,
        payloadPreparationMs: prepMs,
        upload: { status: "blocked", reason: "no Pinata JWT in environment (set PINATA_JWT)" },
        retrieval: { status: "blocked", reason: "upload blocked; no CID to fetch" },
      });
    }
    results.blocker =
      "IPFS upload/retrieval latency NOT measured: no Pinata credentials in " +
      "this environment. Provide a Pinata API JWT (PINATA_JWT env var) and " +
      "re-run: PINATA_JWT=<jwt> node scripts/benchmark-ipfs.js";
  } else {
    // ---- Real network benchmark ----
    for (const size of SIZES) {
      const upLat = [];
      let upOk = 0;
      let cid = null;
      let lastErr = null;
      for (let i = 0; i < TRIALS_PER_SIZE; i++) {
        try {
          const buf = makePdfLikeBuffer(size.bytes);
          const r = await uploadOnce(buf, `${size.label}-${i}`);
          upLat.push(r.ms);
          upOk++;
          cid = r.cid;
        } catch (e) {
          lastErr = e.message;
        }
      }
      const entry = {
        label: size.label,
        bytes: size.bytes,
        upload: { ...summarize(upLat, upOk, TRIALS_PER_SIZE), lastError: lastErr },
      };
      if (cid) {
        const downLat = [];
        let downOk = 0;
        let downErr = null;
        for (let i = 0; i < TRIALS_PER_SIZE; i++) {
          try {
            const r = await retrieveOnce(cid);
            downLat.push(r.ms);
            downOk++;
          } catch (e) {
            downErr = e.message;
          }
        }
        entry.retrieval = { ...summarize(downLat, downOk, TRIALS_PER_SIZE), lastError: downErr, cid };
      } else {
        entry.retrieval = { status: "blocked", reason: "no successful upload produced a CID" };
      }
      results.sizes.push(entry);
    }
  }

  const outDir = path.join(__dirname, "..", "..", "benchmarks");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "ipfs-benchmark.json");
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`✅ JSON → ${jsonPath}`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
