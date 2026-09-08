# InstiChain — Baseline Report (Pre-Change)

Date: 2026-09-09
Environment: Windows 11, Node v24.14.0, npm 11.9.0, Hardhat 2.28.6, OpenZeppelin 5.6.1, Solidity 0.8.28 (cancun)

## 1. Framework / Library Versions

| Component | Version | Source |
|---|---|---|
| React | 18.3.1 | package.json |
| Vite | 5.4.19 | package.json |
| TypeScript | 5.8.3 | package.json |
| ethers.js | 6.16.0 | package.json (frontend + blockchain) |
| Firebase | 12.10.0 | package.json |
| Hardhat | 2.28.6 | blockchain/package.json (installed) |
| OpenZeppelin Contracts | 5.6.1 | blockchain/package.json (installed) |
| Solidity (pragma) | ^0.8.20 | CertificateRegistry.sol |
| Solidity (compiled) | 0.8.28, evmVersion cancun | hardhat.config.js (fixed during this pass) |
| Tailwind | 3.4.17 | package.json |
| react-router-dom | 7.9.1 | package.json |

## 2. Build Status (measured)

- Frontend `npm run build`: **PASS** in 34.87s
  - `dist/assets/index-DrtRklGe.js` = **1,734.54 kB** (gzip 518.50 kB) — main chunk, exceeds 500 kB warning
  - `dist/assets/index-Bkt7uhiP.css` = 71.50 kB (gzip 12.52 kB)
  - `dist/assets/logo-CXiiGQ3y.png` = 751.63 kB (unoptimized asset)
  - Vite warning: "Some chunks are larger than 500 kB after minification"
- Contract compile: **FAILED at baseline** — `blockchain/hardhat.config.js` contained markdown prose (an AI chat reply), not JavaScript. No compilation was possible before this pass.
  - After replacing the config with a valid Hardhat config (Solidity 0.8.28, cancun, optimizer 200 runs): **PASS** — "Compiled 19 Solidity files successfully (evm target: cancun)".

## 3. Lint Status (measured)

`npm run lint` → **FAIL**: 106 problems (96 errors, 10 warnings)

| Rule | Count |
|---|---|
| @typescript-eslint/no-explicit-any | 92 |
| react-refresh/only-export-components | 7 |
| react-hooks/exhaustive-deps | 3 |
| @typescript-eslint/no-empty-object-type | 2 |
| @typescript-eslint/no-require-imports | 1 |
| @typescript-eslint/ban-ts-comment | 1 |

## 4. Type-Check Status (measured)

`npx tsc -b --noEmit` → **PASS** (exit 0).

## 5. Existing Tests (measured)

- **Smart-contract tests: NONE.** No `blockchain/test/` or `blockchain/tests/` directory exists. `npm test` (hardhat test) has nothing to run.
- `tests/test_auto_fix.py` (pytest): **fake test.** Both test functions assert on a hardcoded string literal embedded in the test file itself; they never read `hardhat.config.js` or any repository file. They pass regardless of repository state. They provide zero coverage.
- Frontend unit tests: **NONE** (no test runner configured in package.json).
- Total meaningful automated tests at baseline: **0**.

## 6. Smart-Contract Compilation / Deployment Status

- Compilation: broken at baseline (see §2).
- `blockchain/deployment.json` + `public/contract-deployment.json` contain a stale localhost deployment (address 0x5FbDB2315678afecb367f032d93F642f64180aa3, 2026-03-13) from a previous local run.
- `scripts/authorize-issuer.js` is **broken**: it calls `authorizeIssuer(ISSUER_ADDRESS)` with 1 argument, but the contract signature requires 3 (`address, string adminName, string clubName`). The script would revert/fail at runtime.

## 7. Test Coverage

- Contract coverage: **not measured** (no tests exist; coverage tooling not configured).
- Frontend coverage: **not measured** (no test runner).

## 8. Bundle / Build Size (measured)

See §2. Main JS chunk 1,734.54 kB raw / 518.50 kB gzip. Build time 34.87 s.

## 9. Frontend Performance Metrics

- Not measured at baseline (no Lighthouse run performed before changes).

## 10. Contract Gas Metrics

- Not measured at baseline (no tests/benchmarks existed).

## 11. Documentation State

- README.md: minimal (project scaffold description only; no architecture, setup, test, or security documentation).
- `.env.example` (frontend): references `VITE_WEB3_STORAGE_KEY` but the code actually uses `VITE_PINATA_JWT` — **mismatch**.
- `blockchain/.env.example`: `PRIVATE_KEY`, `AMOY_RPC` — adequate.
- No CI/CD configuration present.

## 12. Critical Defects Found During Discovery (pre-change)

| # | Severity | Location | Issue |
|---|---|---|---|
| D1 | Critical | `blockchain/hardhat.config.js` | File contains markdown prose, not JS. Hardhat cannot run at all (compile/test/deploy all broken). |
| D2 | Critical | `src/lib/blockchain.ts` `getContract()` | Read-only contract access requires `window.ethereum` (MetaMask). The public `/verify` page (no login, no wallet) **cannot verify any certificate** in a wallet-less browser. |
| D3 | High | `CertificateRegistry.sol` `verifyCertificate` | Uses `require` for non-existent / admin-token IDs → reverts. Frontend cannot distinguish "not found" from "revoked" from "error"; a verifier can only get success or a generic error. |
| D4 | High | `CertificateRegistry.sol` | `approve` / `setApprovalForAll` / `increaseAllowance`-style ERC-721 approval paths are not blocked. Approvals are meaningless for soulbound tokens but still writable state (confusing, and a vector for front-running confusion). |
| D5 | High | `CertificateRegistry.sol` `removeIssuer` | Marks admin token invalid but never burns the NFT; `adminWalletToTokenId` retains a stale pointer. |
| D6 | Medium | `CertificateRegistry.sol` | No IPFS CID format validation; arbitrary strings accepted as `ipfsHash`. |
| D7 | Medium | `CertificateRegistry.sol` | No batch size cap; a very large batch can approach/exceed block gas limit (DoS on the only issuance path). |
| D8 | Medium | `scripts/authorize-issuer.js` | Wrong argument count for `authorizeIssuer` (1 vs 3) — script cannot work. |
| D9 | Medium | `src/lib/blockchain.ts` `connectWallet` | Hardcodes chainId 31337 (localhost) and warns/switches for any other network; no env-configurable network. |
| D10 | Medium | `src/firebaseConfig.ts` | Firebase web config hardcoded in source. (Firebase web API keys are public by design, but the config should be env-driven and documented.) |
| D11 | Low | `tests/test_auto_fix.py` | Fake test asserting on a string literal; gives false confidence. |
| D12 | Low | `.env.example` | Documents `VITE_WEB3_STORAGE_KEY` while code uses `VITE_PINATA_JWT`. |
| D13 | Low | `src/components/protectedroute.tsx` | Any authenticated user can access every protected route (no role check) — issuer/head/club routes are not role-gated. |

## 13. Architecture Map (as discovered)

```
Browser (React 18 + Vite + TS + Tailwind + shadcn/ui)
 ├─ Firebase Auth + Firestore  (users, clubs, events, proposals, pendingCertificates)
 ├─ src/lib/blockchain.ts  ── ethers.js v6 ── MetaMask (BrowserProvider)
 │      └─ CertificateRegistry (ERC721 soulbound, Ownable) on EVM
 │            ├─ issueCertificate / batchIssueCertificates (authorized issuers)
 │            ├─ revokeCertificate (owner or issuing address)
 │            ├─ authorizeIssuer / removeIssuer (owner; mints/burns Admin NFT)
 │            └─ verifyCertificate / getCertificate / getCertificatesByOwner
 ├─ src/lib/ipfs.ts ── Pinata HTTP API (VITE_PINATA_JWT) ── CID stored on-chain
 ├─ src/lib/pdfGenerator.ts ── jsPDF + html2canvas (client-side PDF)
 └─ src/lib/qrcode.ts ── QR of /verify/:id URL
Public verify page: /verify/:certificateId (no auth)
```

Trust boundaries:
- Contract owner (deployer) = issuer admin + global revoker.
- Authorized issuers = can issue; only their own certs revocable by them.
- Students = token holders (soulbound, non-transferable).
- Verifiers = anyone with a certificate ID (intended to be wallet-less — currently broken, D2).

---

## 14. Corrections & post-baseline findings (2026-09-09, second audit pass)

Re-verification of the above claims against the working tree as found:

1. **Correction to §2 (compile status):** With `node_modules` as checked in (OpenZeppelin **5.6.1**), the hardened `CertificateRegistry.sol` as found did **NOT compile**: `ERC721 + ERC721Enumerable` diamond inheritance was missing the required `supportsInterface` and `_increaseBalance` overrides (OZ ≥5.0 requires them). The committed artifacts (old ABI with `verifyCertificate → bool`) prove the current source had never been compiled in this environment. **Fix:** removed the unused `ERC721Enumerable` base (no product flow uses index-based enumeration; ~8k gas/mint saved), which also fixes all override errors. Removed leftover scaffold `TestContract.sol` (same compile errors, unused anywhere).
2. **Test suite as found: 74 passing / 8 failing.** All 8 failures were test-code bugs (missing destructured signers, an incompatible `withArgs(undefined)` matcher, an assertion calling `totalSupply()` after the extension removal, wrong fixture variables, a wrong expectation that ignored an admin-NFT mint). All fixed; suite is now **82/82 passing**.
3. **MAX_BATCH_SIZE 100 → 50 (measured):** during gas benchmarking, a 100-certificate batch consumed ~28.7M gas and **exhausted the 30M block gas limit** ("Transaction ran out of gas"). Cap reduced to 50 (≈14.4M gas worst case). See `benchmarks/gas-benchmark.json`.
4. **README.md as found** contained the literal string "nk" only. Replaced with full documentation.
