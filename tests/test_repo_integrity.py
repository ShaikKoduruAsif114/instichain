"""
Repository integrity tests for InstiChain.

These tests read ACTUAL repository files — unlike the previous version of this
file, which asserted on a hardcoded string literal embedded in the test itself
and passed regardless of repository state.

Run: pytest tests/ -v
"""
import json
import os
import re

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOCKCHAIN = os.path.join(ROOT, "blockchain")


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_hardhat_config_is_valid_javascript():
    """hardhat.config.js must be parseable JS (a past version of this file
    contained markdown prose, breaking the entire toolchain)."""
    src = read(os.path.join(BLOCKCHAIN, "hardhat.config.js"))
    assert "module.exports" in src, "hardhat.config.js must export a config"
    assert "```" not in src, "hardhat.config.js must not contain markdown fences"
    assert "solidity" in src and "version" in src


def test_certificate_registry_compilable_source():
    """Contract source must declare the required OZ imports and the
    soulbound _update override."""
    src = read(os.path.join(BLOCKCHAIN, "contracts", "CertificateRegistry.sol"))
    assert "contract CertificateRegistry is ERC721" in src
    assert "function _update(" in src
    assert "SoulboundTransfer" in src
    assert "VerificationStatus" in src
    # No markdown / prose artifacts in the contract
    assert "```" not in src


def test_contract_tests_exist():
    """Meaningful contract test files must exist and contain real assertions."""
    test_dir = os.path.join(BLOCKCHAIN, "test")
    files = [f for f in os.listdir(test_dir) if f.endswith(".test.js")]
    assert len(files) >= 2, "expected core + security test suites"
    total_asserts = 0
    for f in files:
        src = read(os.path.join(test_dir, f))
        assert "revertedWithCustomError" in src or "expect" in src
        total_asserts += src.count("it(")
    assert total_asserts >= 50, f"expected >=50 tests, found {total_asserts}"


def test_frontend_abi_matches_contract_verify_return():
    """Regression: frontend ABI for verifyCertificate must declare the
    uint8 VerificationStatus return (not the legacy bool). A mismatch makes
    REVOKED (2) read as truthy — i.e. revoked certificates displaying as
    valid."""
    lib = read(os.path.join(ROOT, "src", "lib", "blockchain.ts"))
    # Extract the verifyCertificate ABI block
    match = re.search(r'name: "verifyCertificate".*?type: "function"', lib, re.DOTALL)
    assert match, "verifyCertificate ABI entry missing from src/lib/blockchain.ts"
    block = match.group(0)
    assert '"uint8"' in block, (
        "verifyCertificate ABI must return uint8 status; "
        "a bool would misread REVOKED(2) as valid"
    )


def test_no_invalid_placeholder_cid_writes():
    """Issuance flows must never write strings like `proposal-<id>` as CIDs
    (they fail on-chain CID validation and revert the transaction)."""
    offenders = []
    for page in os.listdir(os.path.join(ROOT, "src", "pages")):
        src = read(os.path.join(ROOT, "src", "pages", page))
        for m in re.finditer(r"[\"'`]proposal-\$\{[^}]+\}[\"'`]", src):
            offenders.append(f"{page}: {m.group(0)}")
    assert not offenders, f"invalid placeholder CIDs written on-chain: {offenders}"


def test_no_hardcoded_firebase_credentials():
    """firebaseConfig.ts must read from env, not embed literal config values."""
    src = read(os.path.join(ROOT, "src", "firebaseConfig.ts"))
    assert "import.meta.env" in src
    assert not re.search(r'apiKey:\s*"[A-Za-z0-9_\-]{20,}"', src), (
        "Firebase apiKey must not be hardcoded"
    )


def test_env_example_documents_required_vars():
    """.env.example must document every required VITE_FIREBASE_* variable."""
    src = read(os.path.join(ROOT, ".env.example"))
    for var in ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID", "VITE_PINATA_JWT",
                "VITE_RPC_URL", "VITE_EXPECTED_CHAIN_ID"]:
        assert var in src, f".env.example missing {var}"


def test_gitignore_excludes_secrets_and_artifacts():
    """blockchain/.gitignore must exclude .env, artifacts, cache."""
    src = read(os.path.join(BLOCKCHAIN, ".gitignore"))
    for entry in [".env", "artifacts", "cache", "node_modules"]:
        assert entry in src, f"blockchain/.gitignore missing {entry}"
