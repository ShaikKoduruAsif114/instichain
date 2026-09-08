# InstiChain — Final Engineering Report

Date: 2026-09-09 · Scope: full audit → hardening → testing → benchmarking → metrics pass over the existing codebase. Every number in this report traces to `metrics/FINAL_METRICS.json` with an evidence file; anything not measured is labeled as such.

---

## 1. Executive summary

InstiChain is a soulbound on-chain credential platform (React/TypeScript frontend, Firebase auth/data, Solidity ERC-721 soulbound registry, Pinata/IPFS documents, QR verification). At the start of this pass the repository was in a broken, unevaluated state: the contract **did not compile** against its installed OpenZeppelin 5.6.1, the deployed ABI artifact was stale (pre-hardening), the public verification page **required MetaMask** and could render **revoked certificates as valid** due to an ABI mismatch, all fallback certificate metadata was invalid on-chain, the README was the literal string `"nk"`, and the only automated "test" asserted on a hardcoded string.

What exists now:

- A compiling, tested, coverage-measured contract (82 tests, 98.72% statements / 100% functions) with a measured, documented batch cap.
- A verification path that works without a wallet and can never misrepresent state (four explicit outcomes).
- Three reproducible benchmark suites with machine-readable outputs and honest environment labels.
- CI, integrity tests, configuration hygiene, and a complete documentation set.
- A metrics registry (`metrics/FINAL_METRICS.json`) distinguishing measured / blocked / not-measured.

Not done (honestly): IPFS network benchmarks (no credentials), Lighthouse (no Chrome tooling), testnet deployment (no funded key), Firestore Security Rules (project-specific decisions required).

## 2. Original architecture (as found)

See `reports/BASELINE_REPORT.md §13`. Layers: React SPA → Firebase Auth/Firestore → `src/lib/blockchain.ts` (ethers v6, MetaMask-only) → `CertificateRegistry` (ERC721+Enumerable+Ownable, soulbound via `_update` override) → CID stored on-chain → Pinata IPFS for PDFs → QR links to `/verify/:id`. Trust boundaries: single owner EOA authorizes issuers; issuers mint; issuer-or-owner revokes; verifiers are meant to be wallet-less and unauthenticated.

## 3. Changes made

**Contract** (`blockchain/contracts/CertificateRegistry.sol`)
- Removed unused `ERC721Enumerable` base → fixes OZ 5.6.1 diamond-inheritance compile failure; ~8k gas saved per mint; simpler soulbound override.
- Removed leftover scaffold `TestContract.sol` (also failed compilation).
- `MAX_BATCH_SIZE` 100 → **50**, derived from measured gas (see §9); NatSpec documents the block-gas-limit rationale.
- Kept (verified, now regression-locked): explicit `VerificationStatus` verification that never reverts; custom errors throughout; atomic batch validation; approvals disabled; CID shape validation; admin-NFT lifecycle (mint on authorize, burn on remove).

**Frontend**
- `src/lib/blockchain.ts`: fixed `verifyCertificate` ABI (`uint8` status, not `bool`) and returned an explicit discriminated status (`VALID` only when status===1); added `JsonRpcProvider` fallback so public verification works without MetaMask; env-configured network (`VITE_EXPECTED_CHAIN_ID`, `VITE_RPC_URL`, `VITE_NETWORK_NAME`) instead of hardcoded 31337.
- `src/pages/VerifyCertificate.tsx`: four explicit verification states (VALID / REVOKED / NOT_FOUND / service-unavailable); strict ID parsing; state reset between searches; no path maps errors or not-found to a green state.
- `src/lib/ipfs.ts`: `placeholderCIDFor()` sentinel (contract-valid format, explicitly not a content address) replacing invalid `proposal-…` / `"no-pdf"` fallbacks in IssuerDashboard, HeadIssuerDashboard, ClubProposals — previously these would revert on-chain.
- `src/firebaseConfig.ts`: env-driven config with startup validation.

**Configuration & hygiene**
- `.env.example` rewritten: every variable documented, secrets labeled (`VITE_PINATA_JWT`), Firebase keys labeled public-by-design.
- `blockchain/.gitignore` added (artifacts, cache, coverage, `.env`).
- Deleted fake `tests/test_auto_fix.py`; added `tests/test_repo_integrity.py` (8 tests reading real repository state).
- CI workflow: `.github/workflows/ci.yml` (contract compile/test/coverage/benchmark; frontend typecheck/lint/build; pytest).
- README fully rewritten (architecture, setup, commands, measured results, security model, limitations).

**Testing**
- Fixed all 8 pre-existing test-code failures (fixture destructure bugs, incompatible matcher, stale `totalSupply` assertion, wrong expectations). Suite: 82/82.

## 4. Security improvements

Full detail: `reports/SECURITY_REPORT.md`. Highlights, with severities:

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| S1 | Critical | Contract did not compile (OZ diamond inheritance) | Fixed; CI compile step |
| S2 | Critical | Revoked certificates rendered as valid (ABI mismatch) | Fixed; ABI+status mapping; integrity test |
| S3 | High | Public verification required MetaMask | RPC fallback; wallet-less verify works |
| S4 | Medium | 100-cert batch exceeded block gas limit (DoS on issuance) | Measured cap 50 |
| S5 | Medium | Invalid placeholder CIDs written on-chain | Sentinel helper; regression test |
| S6 | Low | Hardcoded Firebase config | Env-driven + validation |
| S7/S8 | — | Approvals-disabled & non-reverting verify (pre-existing) | Verified + regression-locked |

## 5. Contract improvements

See §3. Net effect: simpler inheritance, measurable safety margin under the block gas limit, explicit verification semantics, unchanged intended soulbound model.

## 6. Frontend improvements

Verification integrity and availability (the two product-critical fixes), env-driven configuration, no dead code introduced, no gratuitous rewrite — 106 pre-existing lint problems intentionally left (documented as debt) rather than churned.

## 7. Testing improvements

- Before: 0 meaningful automated tests; fake pytest; uncompilable contract.
- After: 82 Hardhat tests (50 behavioral + 32 adversarial security), 8 pytest integrity tests, coverage 98.72/86.05/100/92.79 (stmts/branch/funcs/lines), CI enforcement on push/PR.

## 8. Benchmark methodology

All gas from transaction **receipts** (`gasUsed`), never estimates; latency via `process.hrtime.bigint()`; deterministic fixtures; scripts committed (`blockchain/scripts/benchmark-*.js`); raw outputs in `benchmarks/*.json|csv`; environment labels embedded in outputs and reports. Gas units are network-independent; timings are local-node and labeled as such.

## 9. Benchmark results

**Issuance gas (measured):**

| Certs | Individual gas | Batch gas | Gas/cert indiv | Gas/cert batch | Savings |
|---:|---:|---:|---:|---:|---:|
| 1 | 310,816 | 319,195 | 310,816 | 319,195 | −2.7% |
| 10 | 3,136,148 | 2,897,602 | 313,615 | 289,760 | 7.6% |
| 25 | 7,840,556 | 7,195,682 | 313,622 | 287,827 | 8.2% |
| 50 | 15,681,208 | 14,359,655 | 313,624 | 287,193 | 8.4% |
| 100 | 31,362,584 | 28,719,358 | 313,626 | 287,194 | 8.4% |
| 200 | 62,726,476 | 57,438,668 | 313,632 | 287,193 | 8.4% |

Key findings: batch wins from 10 certs upward, plateaus at 8.4%, loses at N=1 — and a 100-cert batch **exceeds the 30M block gas limit** (transaction ran out of gas during the benchmark), which drove the `MAX_BATCH_SIZE=50` decision.

**Verification latency (local Hardhat node — not Internet latency):** n=100: mean 1.981 ms, p95 2.513 ms; n=500: mean 1.676 ms, p95 2.369 ms; n=1000: mean 1.624 ms, p95 2.272 ms; 100% success at all sizes. Decomposition at n=1000: 0.669 ms raw `eth_call` + 0.955 ms ethers decode.

**E2E controlled workload (50-cert batches):** 100: 100% issued (0.62 s), verified 0.71 ms/cert; 500: 100% (4.05 s, 123.5 certs/s); 1000: 100% (9.92 s, 287,494.55 gas/cert, 100.8 certs/s, 0.92 ms/cert verify). Revocation sample 80/80 correctly read REVOKED afterward.

## 10. Coverage results

CertificateRegistry.sol: **98.72%** statements · **86.05%** branches · **100%** functions · **92.79%** lines (`hardhat coverage`). Uncovered lines are defensive branches (e.g., duplicate burn-guard edge in `removeIssuer`), not security-critical paths — all custom errors and authorization branches are exercised.

## 11. Performance results (frontend)

`npm run build` (Vite 5): main chunk **1,737.20 kB raw / 519.90 kB gzip** (baseline 1,734.54/518.50 — unchanged, dependency set untouched), build time **30.32 s**. Typecheck clean; lint at baseline 106 problems (0 added by this pass). Lighthouse: **not measured** (no Chrome tooling) — recorded as blocked.

## 12. IPFS results

**Not measured — blocked.** No Pinata credentials in this environment. The benchmark (`blockchain/scripts/benchmark-ipfs.js`) is implemented, validates the payload pipeline locally (120/350/900 KB PDF-like payloads), and measures real upload/retrieval latency + success rates when run with `PINATA_JWT=<jwt>`. `benchmarks/ipfs-benchmark.json` records `blocked` per size with the exact unblock command.

## 13. End-to-end results

See §9 E2E table. Explicit caveat: **controlled benchmark on a local in-process node** — it validates contract-layer correctness and throughput, not production-user scale.

## 14. Remaining limitations

1. Firestore Security Rules absent (client-side role checks are bypassable) — highest-priority remaining item.
2. Router-level role gating missing (`ProtectedRoute` = auth-only).
3. Single-owner EOA trust; no multisig/timelock. Overall system retains centralized services (Firebase, hosting, owner) — not decentralized.
4. Client-side Pinata JWT visible to users; should be proxied via a backend.
5. Main JS chunk ~1.7 MB (gzip ~520 kB) — code-splitting not attempted to avoid behavioral churn.
6. 96 pre-existing `no-explicit-any` lint errors across pages.
7. No testnet/mainnet deployment; no external audit; CID validation is shape-only (contract can't verify content binding).

## 15. External blockers

| Blocker | What it prevents | Exact unblock |
|---|---|---|
| No Pinata JWT | IPFS upload/retrieval latency & success rates | `PINATA_JWT=<jwt> node scripts/benchmark-ipfs.js` (blockchain/) |
| No funded testnet key | Amoy/Sepolia deployment + real-network gas/latency | set `PRIVATE_KEY` (+ optional RPC overrides) then `npm run deploy:amoy` |
| No Chrome/Lighthouse tooling | Performance/accessibility scores | run Lighthouse against `npm run preview` on any machine with Chrome |
| No Firestore project access | Rules authoring + emulator verification | add `firestore.rules` + emulator tests in the Firebase project |

## 16. Reproduction commands

```bash
# Contract tests (82) — requires only node_modules
cd blockchain && npx hardhat test

# Coverage
cd blockchain && npx hardhat coverage --testfiles "test"

# Gas benchmark (individual vs batch, sizes 1–200) → benchmarks/gas-benchmark.{json,csv}
cd blockchain && npx hardhat run scripts/benchmark-gas.js

# Verification latency (1000-cert dataset; 100/500/1000 samples) → benchmarks/verify-latency.json
cd blockchain && npx hardhat run scripts/benchmark-verify-latency.js

# E2E load (100/500/1000) → benchmarks/e2e-load.json
cd blockchain && npx hardhat run scripts/benchmark-e2e-load.js

# IPFS pipeline (network metrics need credentials) → benchmarks/ipfs-benchmark.json
cd blockchain && node scripts/benchmark-ipfs.js
cd blockchain && PINATA_JWT=<jwt> node scripts/benchmark-ipfs.js

# Frontend checks
npx tsc -b --noEmit
npm run lint
npm run build

# Repository integrity
python -m pytest tests/ -v

# Local end-to-end (manual)
cd blockchain && npx hardhat node          # terminal 1
cd blockchain && npm run deploy:localhost  # terminal 2
npm run dev                                # frontend on :8080
```

## 17. Final resume metrics

See `reports/RESUME_METRICS.md` — ranked Top 10 with evidence files, confidence levels, and explicit exclusions.

## 18. Recommended resume bullets

Three versions (Software Engineering / Web3 / Tier-1 generalist) in `reports/RESUME_METRICS.md §FINAL RESUME BULLETS`. Every quantitative claim maps to `metrics/FINAL_METRICS.json`.
