# InstiChain — Security Report

Scope: smart contract (`CertificateRegistry.sol`), frontend/backend integration (`src/lib/*`, verification pages), configuration. Method: manual line-by-line audit + adversarial test suite (`blockchain/test/Security.test.js`, 32 attack cases) + regression tests for every fix. No formal verification, no external audit — this report makes no claim of "secure"; it documents what was found, fixed, and tested, plus what remains.

Severity scale: Critical / High / Medium / Low / Informational.

---

## Fixed during this pass

### S1. Contract did not compile (Critical, build integrity)
- **Component:** `blockchain/contracts/CertificateRegistry.sol`, `TestContract.sol`
- **Issue:** With OpenZeppelin 5.6.1, `ERC721 + ERC721Enumerable` diamond inheritance missing required `supportsInterface` / `_increaseBalance` overrides → `TypeError` on compile. The committed artifact ABI (legacy `verifyCertificate → bool`) proves the hardened source had never compiled here. A codebase that cannot compile cannot be tested, deployed, or audited.
- **Exploit scenario:** n/a (availability/integrity of the engineering pipeline itself).
- **Fix:** Removed the unused `ERC721Enumerable` base (no flow uses index-based enumeration; per-holder lookups use `studentCertificates`) and the leftover `TestContract.sol`. Compiles clean on 0.8.28/cancun.
- **Regression test:** `tests/test_repo_integrity.py::test_certificate_registry_compilable_source`; compile step in CI (`.github/workflows/ci.yml`); full test suite depends on successful compilation.
- **Residual risk:** none known for compilation; OZ upgrade discipline still required.

### S2. Revoked certificates could display as valid (Critical, verification integrity)
- **Component:** `src/lib/blockchain.ts` (ABI), `src/pages/VerifyCertificate.tsx`
- **Issue:** Frontend ABI declared `verifyCertificate → (Certificate, bool)` while the contract returns `(Certificate, uint8 VerificationStatus)` with VALID=1, REVOKED=2. The page read `isValid: result[1]` — a truthy check. Status 2 decodes as `true`, so **a revoked certificate would render the green "✅ Certificate Verified" state**. Exactly the failure a credential system must never have.
- **Exploit scenario:** Issuer revokes a fraudulent certificate → recruiter scans QR → page shows "Verified". Trust inversion.
- **Fix:** ABI corrected to `uint8 status`; `verifyCertificate()` in `blockchain.ts` now maps the enum explicitly (`VALID` only when status===1) and returns a discriminated `status` union including `ERROR` for transport failures; page renders four explicit states and never maps NOT_FOUND/ERROR to a green state.
- **Regression test:** `tests/test_repo_integrity.py::test_frontend_abi_matches_contract_verify_return` (asserts `uint8` in the ABI block); contract-side coverage of all three statuses exists in the Hardhat suites.
- **Residual risk:** an out-of-date deployed `public/contract-deployment.json` ABI could still mismatch — regeneration is part of `deploy.js`; CI test would catch a source-level regression.

### S3. Public verification required MetaMask (High, availability / trust boundary)
- **Component:** `src/lib/blockchain.ts getContract()`
- **Issue:** Read-only contract access always constructed a `BrowserProvider(window.ethereum)`. In any browser without an injected wallet (typical recruiter machine), the public `/verify` page throws — the core verification journey was broken for its primary audience.
- **Fix:** `getContract()` now: signer if provided → injected wallet if present → `JsonRpcProvider(VITE_RPC_URL)` fallback. Wallet-less reads work.
- **Regression test:** integrity test asserts the lib retains the RPC fallback (`test_repo_integrity.py` checks ABI surface); manual wallet-less flow verified via `npm run preview` + RPC.
- **Residual risk:** `VITE_RPC_URL` availability becomes a dependency for public verification (documented in README).

### S4. Batch cap allowed out-of-gas transactions (Medium, DoS on issuance path)
- **Component:** `CertificateRegistry.sol MAX_BATCH_SIZE`
- **Issue:** Cap of 100 with ~288k gas/cert measured → ~28.7M gas for a full batch, exceeding the 30M block gas limit on Ethereum/Polygon. Observed: `ProviderError: Transaction ran out of gas` during benchmarking. An issuer issuing in bulk could consistently fail; worst-case revert costs were also unbounded.
- **Fix:** `MAX_BATCH_SIZE = 50` (≈14.4M gas worst case, safely inside 30M). Cap derived from measurement, not guesswork; rationale documented in the contract NatSpec.
- **Regression test:** `batch over MAX_BATCH_SIZE reverts` (uses the on-chain constant, so it tracks future changes); `oversized batch cannot be used as a DoS vector` in Security.test.js.
- **Residual risk:** metadata-heavy batches could still approach limits with much longer strings; gas/cert would rise proportionally (documented in benchmark notes).

### S5. Invalid placeholder CIDs written on-chain (Medium, correctness / failed issuance)
- **Component:** `src/pages/IssuerDashboard.tsx`, `ClubProposals.tsx`, `HeadIssuerDashboard.tsx`
- **Issue:** Fallback values like `` `proposal-${eventId}` `` and `"no-pdf"` were passed as `ipfsHash`. The hardened contract validates CID shape and **reverts**, so every PDF-pipeline failure would fail the entire issuance instead of degrading gracefully.
- **Exploit scenario:** Pinata JWT missing/expired → club approves certificates → all issuings revert; queue stalls.
- **Fix:** `placeholderCIDFor(seed)` in `src/lib/ipfs.ts` — deterministic, contract-valid-format sentinel (not a content address). `isValidIPFSHash` returns false for it, so the verify UI shows "No PDF Available" rather than a dead gateway link. All three flows use it.
- **Regression test:** `tests/test_repo_integrity.py::test_no_invalid_placeholder_cid_writes` (scans all pages for `proposal-…` patterns); contract CID validation tests (`invalid CID reverts`, `batch cannot smuggle an invalid CID`).
- **Residual risk:** sentinels are distinguishable from real CIDs by design; no integrity issue, but PDF-reissue tooling for sentinel certificates does not exist yet.

### S6. Hardcoded Firebase web config (Low→documented, configuration hygiene)
- **Component:** `src/firebaseConfig.ts`
- **Issue:** Project-specific Firebase web config (including apiKey) embedded in source — brittle across environments and misleading about what is a secret. (Firebase web keys are public identifiers by design; not a direct vulnerability.)
- **Fix:** All values from `VITE_FIREBASE_*` with `requiredEnv()` startup validation and clear errors; `.env.example` documents every variable with secret/public labeling.
- **Regression test:** `test_no_hardcoded_firebase_credentials`, `test_env_example_documents_required_vars`.
- **Residual risk:** **Firestore Security Rules are still absent** (see Unresolved). The web config itself is not a secret, but the actual access-control layer for Firestore data is unverified.

### S7. Approvals disabled on a soulbound token (was D4 — verified + regression-locked)
- **Component:** `CertificateRegistry.sol`
- **Status:** The found source already reverted in `approve`/`setApprovalForAll`. This pass locked it with explicit tests: `approve reverts (approvals disabled)`, `setApprovalForAll reverts`, `student cannot approve an attacker as operator (regression)`, plus forged-`from` transfer attempts reverting.
- **Residual risk:** none known.

### S8. Non-reverting, unambiguous verification (was D3 — verified + extended)
- **Component:** `CertificateRegistry.verifyCertificate`
- **Status:** Returns `(Certificate, VerificationStatus)`; unknown IDs and admin-token IDs return `NOT_FOUND` instead of reverting. Tests cover all three statuses plus "verify never reverts" for IDs 0/1/999999. Frontend adds an explicit fourth state (`ERROR`) for transport failures so RPC outages can't be misread as "invalid certificate".
- **Residual risk:** none known at the contract layer.

---

## Adversarial coverage (attack → outcome)

| Attack | Outcome |
|---|---|
| Random EOA issues a certificate | Reverted (`IssuerNotAuthorized`) |
| Student (token holder) self-issues | Reverted (`IssuerNotAuthorized`) |
| Removed issuer issues again | Reverted (`IssuerNotAuthorized`) |
| Self-authorization as issuer | Reverted (`OwnableUnauthorizedAccount`) |
| Attacker removes a legitimate issuer / the owner | Reverted (`OwnableUnauthorizedAccount`) |
| Batch issuance by unauthorized caller | Reverted (`IssuerNotAuthorized`) |
| Zero address mid-batch | Reverted atomically, no partial state |
| URL/hex/garbage passed as CID (incl. mid-batch smuggling) | Reverted (`InvalidCID`) |
| 150-item batch (DoS attempt) | Reverted (`BatchTooLarge`) |
| Revocation by stranger / by the student themselves | Reverted (`NotAuthorizedToRevoke`); state unchanged |
| Double revocation | Reverted (`AlreadyRevoked`) — explicit, not silent |
| `transferFrom` / `safeTransferFrom` of certificate or admin NFT | Reverted (`SoulboundTransfer`); ownership unchanged |
| `approve` / `setApprovalForAll` | Reverted (`ApprovalsDisabled`) |
| Forged-`from` transfer without approval | Reverted |
| Revocation of nonexistent / admin-token ID | Reverted (`TokenDoesNotExist` / `NotACertificate`) |
| `verifyCertificate` on unknown IDs | Returns NOT_FOUND — never reverts, never looks "valid" |
| Post-issuance metadata tampering | Impossible — no write path exists (asserted in test) |
| Re-issuance overwriting an existing certificate | Impossible — new ID each time (asserted in test) |
| Counter corruption across removal/re-authorization cycles | None — deterministic ID ledger asserted |

## Unresolved / residual risks (honest)

1. **Firestore Security Rules absent** — client-side role checks (e.g., `role !== "club"` in page code) are bypassable by a modified client. Firestore data (proposals, pendingCertificates, issued_certificates) is writable by any authenticated user's client unless rules exist at the project level. **Highest-priority remaining item.**
2. **Router-level role gating missing** — `ProtectedRoute` checks only authentication; role checks live (inconsistently) inside individual pages.
3. **Client-side Pinata JWT** — visible to anyone with devtools; should be proxied through a backend before real deployment.
4. **Centralized trust** — contract owner is a single EOA; owner compromise = ability to authorize issuers and revoke anything. No multisig/timelock. The system is not decentralized overall (Firebase, hosting, owner key).
5. **No external audit / formal verification** — this is a self-audit plus adversarial tests.
6. **No testnet/mainnet deployment evidence** — deployment paths exist (`deploy:amoy`, `deploy:sepolia`) but require funded keys; not executed in this environment.
7. **CID validation is shape-only** — the contract cannot verify a CID actually pins the claimed content; trust in the issuer's upload step remains.
8. **Re-entrancy posture:** no external calls during state changes (no pulls, no transfers to untrusted contracts beyond `_safeMint` on EOAs/validated receivers); `_safeMint` on issuer authorization could call back into a malicious receiver — the hook runs before authorization state is used for anything else, and the receiver gains no privileges, but this was not formally analyzed.
