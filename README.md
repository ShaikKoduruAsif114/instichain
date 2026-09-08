# InstiChain

Soulbound (non-transferable) on-chain credential platform for institutes: clubs issue certificates as ERC-721 soulbound tokens, students hold them, and anyone — **with or without a wallet or an account** — can verify a certificate against the blockchain via a public page or a QR code.

## Architecture

```
Browser (React 18 + Vite + TypeScript + Tailwind/shadcn)
 ├─ Firebase Auth + Firestore          (users, clubs, events, proposals, pending queue)
 ├─ src/lib/blockchain.ts ── ethers.js v6 ─┬─ MetaMask (BrowserProvider)  → writes
 │                                          └─ JsonRpcProvider (VITE_RPC_URL) → wallet-less reads
 │        └─ CertificateRegistry (soulbound ERC-721, Ownable)
 │              ├─ issueCertificate / batchIssueCertificates   (authorized issuers)
 │              ├─ revokeCertificate                            (issuer or owner)
 │              ├─ authorizeIssuer / removeIssuer               (owner; mints/burns Admin NFT)
 │              └─ verifyCertificate → VALID | REVOKED | NOT_FOUND  (never reverts)
 ├─ src/lib/ipfs.ts    ── Pinata HTTP API (VITE_PINATA_JWT) ── CID stored on-chain
 ├─ src/lib/pdfGenerator.ts ── jsPDF (client-side certificate PDF)
 └─ src/lib/qrcode.ts  ── QR of {origin}/verify/{certificateId}

Public verification: /verify (search) and /verify/:certificateId (QR target) — no login required
```

Trust model: the deployer (`owner`) authorizes issuers; authorized issuers mint credentials; only the issuing address or the owner can revoke; every token — admin NFTs and certificates — is non-transferable, and approvals are disabled outright. All certificate metadata is immutable after issuance (there is no update path on-chain).

## Repository layout

| Path | What it is |
|---|---|
| `src/` | React frontend (pages, lib integration layers, UI kit) |
| `blockchain/contracts/CertificateRegistry.sol` | The soulbound credential contract |
| `blockchain/test/` | Hardhat test suites (core behavior + adversarial security) |
| `blockchain/scripts/` | deploy, authorize-issuer, benchmark scripts |
| `benchmarks/` | Machine-readable benchmark outputs (JSON/CSV) |
| `reports/` | Baseline, security, and final engineering reports |
| `metrics/` | `FINAL_METRICS.json` — single source of truth for every reported number |
| `tests/` | Repository integrity tests (pytest) |
| `.github/workflows/ci.yml` | CI: compile → test → coverage → benchmark → typecheck → build |

## Setup

```bash
# Frontend
npm install
cp .env.example .env        # fill in Firebase + Pinata values
npm run dev                 # http://localhost:8080

# Blockchain workspace
cd blockchain
npm install
```

### Environment variables

Everything is documented in [`.env.example`](.env.example). Summary:

| Variable | Scope | Used for | Secret? |
|---|---|---|---|
| `VITE_EXPECTED_CHAIN_ID` | frontend | chain the wallet must be on (default 31337 Hardhat) | no |
| `VITE_RPC_URL` | frontend | read-only RPC for the public verify page (no wallet needed) | no |
| `VITE_NETWORK_NAME` | frontend | network label in wallet prompts | no |
| `VITE_PINATA_JWT` | frontend | pinning certificate PDFs to IPFS | **yes — treat as secret** |
| `VITE_FIREBASE_*` | frontend | Firebase web app config | no (public identifiers; access is controlled by Firebase Auth + Firestore rules) |
| `PRIVATE_KEY` | blockchain | deployer key for testnets — **never commit** | **yes** |
| `AMOY_RPC` / `SEPOLIA_RPC` | blockchain | custom RPC endpoints | no |

Firebase web API keys are public by design; real access control must come from Firestore Security Rules (not yet present in this repo — see Limitations). Never put service-account keys in `VITE_*` variables.

## Smart contract

`blockchain/contracts/CertificateRegistry.sol` — Solidity 0.8.28, OpenZeppelin 5.x, optimizer on (200 runs).

Key protections (each covered by tests):

- **Soulbound**: `_update` reverts on any transfer between non-zero addresses; `approve`/`setApprovalForAll` always revert (`ApprovalsDisabled`).
- **Authorization**: issuance/batch issuance require `authorizedIssuers[msg.sender]`; issuer admin is `onlyOwner`; revocation restricted to issuing address or owner — with explicit custom errors (`IssuerNotAuthorized`, `NotAuthorizedToRevoke`, …).
- **Input validation**: zero addresses, empty strings, malformed CIDs (CIDv0/CIDv1 shape-checked), empty/oversized/mismatched batches (`EmptyBatch`, `BatchTooLarge`, `MismatchedArrayLengths`).
- **Atomic batches**: any invalid entry reverts the whole transaction — no partial state.
- **Explicit verification**: `verifyCertificate` returns `(Certificate, VerificationStatus)` where status ∈ {NOT_FOUND, VALID, REVOKED}; it never reverts, so a verifier can never confuse "not found" with "revoked" or with a transport error.
- `MAX_BATCH_SIZE = 50` — chosen from measurement: a batch costs ≈288k gas/certificate, so a 100-certificate batch (~29M gas) **exceeds the 30M block gas limit** of Ethereum/Polygon (observed "out of gas" during benchmarking; see [Benchmarks](#benchmarks)).

### Commands

```bash
cd blockchain
npm run compile                  # compile contracts
npm test                         # 82 tests (core + security suites)
npx hardhat coverage --testfiles "test"   # coverage report
npm run node                     # local node on :8545
npm run deploy:localhost         # deploy + write deployment.json / public/contract-deployment.json
npx hardhat run scripts/authorize-issuer.js --network localhost
                                 # env: ISSUER_ADDRESS, ADMIN_NAME, CLUB_NAME
```

## Frontend

```bash
npm run dev          # dev server
npm run build        # production build → dist/
npm run preview      # serve the production build
npx tsc -b --noEmit  # typecheck (clean)
npm run lint         # ESLint (96 pre-existing errors tracked; see reports/)
```

Verification flow: anyone opens `/verify/:certificateId` (e.g. by scanning a certificate's QR code). The page reads the contract through `VITE_RPC_URL` — **no wallet, no login** — and renders one of four explicit states: **VALID**, **REVOKED**, **NOT_FOUND**, or **service unavailable** (RPC error). It never displays a certificate as valid unless the on-chain status is `VALID`.

## Benchmarks

All numbers below were measured on this machine (Windows 11, Node v24.14.0, Hardhat 2.28.6, Solidity 0.8.28 cancun) against the **local Hardhat in-process network**. Gas units are network-independent; **timings are not representative of public-network latency**. Raw data: [`benchmarks/gas-benchmark.json`](benchmarks/gas-benchmark.json), [`benchmarks/verify-latency.json`](benchmarks/verify-latency.json), [`benchmarks/e2e-load.json`](benchmarks/e2e-load.json).

```bash
cd blockchain
npx hardhat run scripts/benchmark-gas.js               # individual vs batch, sizes 1–200
npx hardhat run scripts/benchmark-verify-latency.js    # 100/500/1000 verifications, percentiles
npx hardhat run scripts/benchmark-e2e-load.js          # issue+verify+revoke at 100/500/1000 scale
node scripts/benchmark-ipfs.js                          # IPFS pipeline (needs PINATA_JWT for network runs)
```

### Issuance gas (measured, receipts)

| Certificates | Individual total gas | Batch total gas | Gas/cert (indiv) | Gas/cert (batch) | Gas saved |
|---:|---:|---:|---:|---:|---:|
| 1 | 310,816 | 319,195 | 310,816 | 319,195 | **−2.7%** (batch costs more) |
| 10 | 3,136,148 | 2,897,602 | 313,615 | 289,760 | 7.6% |
| 25 | 7,840,556 | 7,195,682 | 313,622 | 287,827 | 8.2% |
| 50 | 15,681,208 | 14,359,655 | 313,624 | 287,193 | 8.4% |
| 100 | 31,362,584 | 28,719,358 | 313,626 | 287,194 | 8.4% |
| 200 | 62,726,476 | 57,438,668 | 313,632 | 287,193 | 8.4% |

Note the honest nuances: a single-certificate batch costs *more* than an individual issuance, savings plateau at ≈8.4%, and a 100-cert batch (~28.7M gas) does **not** fit in a 30M block — hence `MAX_BATCH_SIZE = 50`.

### Verification latency (local node; not Internet latency)

| Sample | Mean | p95 | Success |
|---:|---:|---:|---:|
| 100 | 1.98 ms | 2.51 ms | 100% |
| 500 | 1.68 ms | 2.37 ms | 100% |
| 1000 | 1.62 ms | 2.27 ms | 100% |

Of the mean, ≈0.67 ms is the raw RPC `eth_call` and ≈0.95 ms is ethers.js ABI decoding. A public-RPC deployment will add Internet RTT (tens of ms) on top — not measured here. Full percentiles: [`benchmarks/verify-latency.json`](benchmarks/verify-latency.json).

### End-to-end workload (controlled benchmark, 50-cert batches)

| Scale | Issued | Issue time | Gas/cert | Verified | Revocation check |
|---:|---:|---:|---:|---:|---|
| 100 | 100/100 (100%) | 0.62 s | 287,454.54 | 100/100, 0.71 ms/cert | 5/5 → REVOKED |
| 500 | 500/500 (100%) | 4.05 s | 287,493.17 | 500/500, 0.95 ms/cert | 25/25 → REVOKED |
| 1000 | 1000/1000 (100%) | 9.92 s | 287,494.55 | 1000/1000, 0.92 ms/cert | 50/50 → REVOKED |

This measures contract-layer throughput in a controlled environment. It does **not** model production mempool latency, public-RPC rate limits, or real user concurrency.

### Coverage (measured, hardhat coverage)

| File | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| CertificateRegistry.sol | 98.72% | 86.05% | 100% | 92.79% |

### IPFS

Upload/retrieval latency is **not measured** — no Pinata credentials in the development environment. The benchmark script exists and validates the payload pipeline locally; with a JWT it measures real upload/retrieval latency and success rates:

```bash
PINATA_JWT=<your_jwt> node scripts/benchmark-ipfs.js
```

## Security model & testing

- `blockchain/test/Security.test.js` documents and asserts resistance to: unauthorized issuance and batch issuance, self-authorization, issuer removal by non-owners, revocation by students/strangers, credential transfer and approval attempts (including admin-NFT privilege theft), oversized/malformed batches, invalid IDs, cross-type ID confusion (certificate vs admin token), and post-issuance metadata tampering (no write path exists).
- Regression tests were added for every defect fixed during this hardening pass; the full trail with severities is in [`reports/SECURITY_REPORT.md`](reports/SECURITY_REPORT.md).
- 82 Hardhat tests + 8 repository-integrity tests pass in CI.

## Limitations (honest)

- **Centralized components remain**: Firebase (auth, Firestore), the frontend host, and the contract owner key are centralized. This is *not* a decentralized system; the blockchain layer adds tamper-evidence for issued credentials, nothing more.
- **No Firestore Security Rules** are in the repository — server-side authorization for Firestore data is unverified and must be added before real deployment.
- **IPFS performance is unmeasured** without credentials (script ready).
- **Route protection is UI-level**: any authenticated user can open any protected route (role checks exist inside some pages, not the router).
- **The Pinata JWT is client-side** and visible to anyone with devtools; real deployments should proxy uploads through a backend.
- **No Lighthouse/a11y audit numbers** are reported (no Chrome tooling available in this environment).
- Frontend lint debt: 96 pre-existing `no-explicit-any` and related errors, unchanged by this pass.
- Local-network gas is zero-fee; ETH/POL cost at a given gas price is trivially derivable from the measured gas figures but is not quoted here.

## Reports

- [`reports/BASELINE_REPORT.md`](reports/BASELINE_REPORT.md) — pre-change state (build was broken; zero meaningful tests)
- [`reports/SECURITY_REPORT.md`](reports/SECURITY_REPORT.md) — findings, fixes, regression tests, residual risks
- [`reports/FINAL_ENGINEERING_REPORT.md`](reports/FINAL_ENGINEERING_REPORT.md) — full engineering narrative
- [`metrics/FINAL_METRICS.json`](metrics/FINAL_METRICS.json) — every reported number with method + evidence file
- [`reports/RESUME_METRICS.md`](reports/RESUME_METRICS.md) — vetted, evidence-backed resume metrics
