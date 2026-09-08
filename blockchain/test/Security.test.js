/**
 * CertificateRegistry — security / adversarial test suite
 *
 * Each test documents an attack attempt and asserts the contract resists it.
 * These double as regression tests for the fixes in the hardened contract.
 *
 * Run: npx hardhat test test/Security.test.js
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const CID_V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtSgPgvodDkJZj2oG6MqX";
const STUDENT = "0x000000000000000000000000000000000000dEaD";
const ZERO = ethers.ZeroAddress;

async function deployFixture() {
  const [owner, issuer, attacker, student1, student2] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Factory.deploy();
  await registry.waitForDeployment();
  await registry
    .connect(owner)
    .authorizeIssuer(issuer.address, "Alice Admin", "Robotics Club");
  return { registry, owner, issuer, attacker, student1, student2 };
}

describe("Security / adversarial", function () {
  // ---------- Unauthorized issuance ----------
  describe("Unauthorized issuance", function () {
    it("random EOA cannot issue a certificate", async function () {
      const { registry, attacker, student1 } = await loadFixture(deployFixture);
      await expect(
        registry
          .connect(attacker)
          .issueCertificate(student1.address, "Victim", "Fake Degree", "Fake Uni", CID_V0)
      ).to.be.revertedWithCustomError(registry, "IssuerNotAuthorized");
    });

    it("a student holding a certificate cannot issue new ones", async function () {
      const { registry, issuer, student1 } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(student1.address, "S", "C", "I", CID_V0);
      await tx.wait();
      await expect(
        registry
          .connect(student1)
          .issueCertificate(student1.address, "S", "C", "I", CID_V0)
      ).to.be.revertedWithCustomError(registry, "IssuerNotAuthorized");
    });

    it("removed issuer cannot issue after removal (regression: stale authorization)", async function () {
      const { registry, owner, issuer, student1 } = await loadFixture(deployFixture);
      await registry.connect(owner).removeIssuer(issuer.address);
      await expect(
        registry
          .connect(issuer)
          .issueCertificate(student1.address, "S", "C", "I", CID_V0)
      ).to.be.revertedWithCustomError(registry, "IssuerNotAuthorized");
    });
  });

  // ---------- Unauthorized batch issuance ----------
  describe("Unauthorized batch issuance", function () {
    it("random EOA cannot batch-issue", async function () {
      const { registry, attacker, student1 } = await loadFixture(deployFixture);
      await expect(
        registry
          .connect(attacker)
          .batchIssueCertificates(
            [student1.address],
            ["S"],
            ["C"],
            ["I"],
            [CID_V0]
          )
      ).to.be.revertedWithCustomError(registry, "IssuerNotAuthorized");
    });

    it("batch cannot be used to bypass per-entry validation (zero address mid-batch)", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(
        registry
          .connect(issuer)
          .batchIssueCertificates(
            [STUDENT, ZERO, STUDENT],
            ["A", "B", "C"],
            ["C", "C", "C"],
            ["I", "I", "I"],
            [CID_V0, CID_V0, CID_V0]
          )
      ).to.be.revertedWithCustomError(registry, "InvalidAddress");
    });

    it("batch cannot smuggle an invalid CID (regression: CID validation)", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(
        registry
          .connect(issuer)
          .batchIssueCertificates(
            [STUDENT, STUDENT],
            ["A", "B"],
            ["C", "C"],
            ["I", "I"],
            [CID_V0, "http://evil.example/fake.pdf"]
          )
      ).to.be.revertedWithCustomError(registry, "InvalidCID");
    });

    it("oversized batch cannot be used as a DoS vector (regression: MAX_BATCH_SIZE)", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const max = Number(await registry.MAX_BATCH_SIZE());
      const n = max + 50;
      const addrs = Array.from({ length: n }, () => ethers.Wallet.createRandom().address);
      const strs = Array.from({ length: n }, () => "S");
      await expect(
        registry
          .connect(issuer)
          .batchIssueCertificates(addrs, strs, strs, strs, Array(n).fill(CID_V0))
      ).to.be.revertedWithCustomError(registry, "BatchTooLarge");
    });
  });

  // ---------- Unauthorized issuer administration ----------
  describe("Issuer administration", function () {
    it("attacker cannot authorize themselves as issuer", async function () {
      const { registry, attacker } = await loadFixture(deployFixture);
      await expect(
        registry.connect(attacker).authorizeIssuer(attacker.address, "X", "Y")
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("attacker cannot remove a legitimate issuer", async function () {
      const { registry, issuer, attacker } = await loadFixture(deployFixture);
      await expect(
        registry.connect(attacker).removeIssuer(issuer.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("owner cannot be removed by attacker (no self-removal path exists)", async function () {
      const { registry, owner, attacker } = await loadFixture(deployFixture);
      await expect(
        registry.connect(attacker).removeIssuer(owner.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });

  // ---------- Unauthorized revocation ----------
  describe("Revocation attacks", function () {
    it("attacker cannot revoke someone else's certificate", async function () {
      const { registry, issuer, attacker } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "S", "C", "I", CID_V0);
      const rcpt = await tx.wait();
      const id = rcpt.logs
        .map((l) => {
          try {
            return registry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p) => p && p.name === "CertificateIssued").args.certificateId;

      await expect(
        registry.connect(attacker).revokeCertificate(id)
      ).to.be.revertedWithCustomError(registry, "NotAuthorizedToRevoke");
      expect((await registry.getCertificate(id)).valid).to.equal(true);
    });

    it("student cannot revoke their own certificate", async function () {
      const { registry, issuer, student1 } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(student1.address, "S", "C", "I", CID_V0);
      const rcpt = await tx.wait();
      const id = rcpt.logs
        .map((l) => {
          try {
            return registry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p) => p && p.name === "CertificateIssued").args.certificateId;

      await expect(
        registry.connect(student1).revokeCertificate(id)
      ).to.be.revertedWithCustomError(registry, "NotAuthorizedToRevoke");
    });

    it("double-revocation is rejected (idempotency is explicit, not silent)", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "S", "C", "I", CID_V0);
      const rcpt = await tx.wait();
      const id = rcpt.logs
        .map((l) => {
          try {
            return registry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p) => p && p.name === "CertificateIssued").args.certificateId;

      await registry.connect(issuer).revokeCertificate(id);
      await expect(
        registry.connect(issuer).revokeCertificate(id)
      ).to.be.revertedWithCustomError(registry, "AlreadyRevoked");
    });
  });

  // ---------- Credential transfer / approval attacks ----------
  describe("Transfer & approval attacks", function () {
    it("student cannot transfer a certificate to an attacker", async function () {
      const { registry, issuer, student1, attacker } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(student1.address, "S", "C", "I", CID_V0);
      await tx.wait();
      const ids = await registry.getCertificatesByOwner(student1.address);
      await expect(
        registry
          .connect(student1)
          .transferFrom(student1.address, attacker.address, ids[0])
      ).to.be.revertedWithCustomError(registry, "SoulboundTransfer");
      // Ownership unchanged
      expect(await registry.ownerOf(ids[0])).to.equal(student1.address);
    });

    it("student cannot approve an attacker as operator (regression: approvals disabled)", async function () {
      const { registry, issuer, student1, attacker } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(student1.address, "S", "C", "I", CID_V0);
      await tx.wait();
      const ids = await registry.getCertificatesByOwner(student1.address);
      await expect(
        registry.connect(student1).approve(attacker.address, ids[0])
      ).to.be.revertedWithCustomError(registry, "ApprovalsDisabled");
      await expect(
        registry.connect(student1).setApprovalForAll(attacker.address, true)
      ).to.be.revertedWithCustomError(registry, "ApprovalsDisabled");
    });

    it("attacker cannot use transferFrom with a forged 'from' (no approval exists)", async function () {
      const { registry, issuer, student1, attacker } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(student1.address, "S", "C", "I", CID_V0);
      await tx.wait();
      const ids = await registry.getCertificatesByOwner(student1.address);
      await expect(
        registry
          .connect(attacker)
          .transferFrom(student1.address, attacker.address, ids[0])
      ).to.be.reverted;
    });

    it("admin NFT cannot be transferred to an attacker (privilege theft attempt)", async function () {
      const { registry, issuer, attacker } = await loadFixture(deployFixture);
      const adminId = await registry.adminWalletToTokenId(issuer.address);
      await expect(
        registry
          .connect(issuer)
          .transferFrom(issuer.address, attacker.address, adminId)
      ).to.be.revertedWithCustomError(registry, "SoulboundTransfer");
    });
  });

  // ---------- Malformed / invalid inputs ----------
  describe("Malformed inputs", function () {
    it("zero-address student is rejected", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(
        registry.connect(issuer).issueCertificate(ZERO, "S", "C", "I", CID_V0)
      ).to.be.revertedWithCustomError(registry, "InvalidAddress");
    });

    it("zero-address issuer is rejected", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      await expect(
        registry.connect(owner).authorizeIssuer(ZERO, "A", "B")
      ).to.be.revertedWithCustomError(registry, "InvalidAddress");
    });

    it("empty strings are rejected for all named fields", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(
        registry.connect(issuer).issueCertificate(STUDENT, "", "C", "I", CID_V0)
      ).to.be.revertedWithCustomError(registry, "EmptyString");
      await expect(
        registry.connect(issuer).issueCertificate(STUDENT, "S", "", "I", CID_V0)
      ).to.be.revertedWithCustomError(registry, "EmptyString");
      await expect(
        registry.connect(issuer).issueCertificate(STUDENT, "S", "C", "", CID_V0)
      ).to.be.revertedWithCustomError(registry, "EmptyString");
    });

    it("non-CID strings (URLs, hex, garbage) are rejected as ipfsHash", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const bad = [
        "https://example.com/cert.pdf",
        "0x1234567890abcdef",
        "Qm" + "x".repeat(10), // too short for CIDv0
        "b" + "x".repeat(5), // too short for CIDv1
        "Qm" + "x".repeat(100), // too long for CIDv0
      ];
      for (const cid of bad) {
        await expect(
          registry.connect(issuer).issueCertificate(STUDENT, "S", "C", "I", cid)
        ).to.be.revertedWithCustomError(registry, "InvalidCID");
      }
    });

    it("mismatched batch lengths are rejected", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(
        registry
          .connect(issuer)
          .batchIssueCertificates(
            [STUDENT, STUDENT],
            ["A"],
            ["C", "C"],
            ["I", "I"],
            [CID_V0, CID_V0]
          )
      ).to.be.revertedWithCustomError(registry, "MismatchedArrayLengths");
    });

    it("empty batch is rejected", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(
        registry.connect(issuer).batchIssueCertificates([], [], [], [], [])
      ).to.be.revertedWithCustomError(registry, "EmptyBatch");
    });
  });

  // ---------- Invalid IDs / state confusion ----------
  describe("ID & state confusion", function () {
    it("cannot revoke a non-existent certificate", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      await expect(
        registry.connect(owner).revokeCertificate(42n)
      ).to.be.revertedWithCustomError(registry, "TokenDoesNotExist");
    });

    it("cannot revoke an admin token ID as if it were a certificate", async function () {
      const { registry, owner, issuer } = await loadFixture(deployFixture);
      const adminId = await registry.adminWalletToTokenId(issuer.address);
      await expect(
        registry.connect(owner).revokeCertificate(adminId)
      ).to.be.revertedWithCustomError(registry, "NotACertificate");
    });

    it("verifyCertificate never reverts — unknown IDs yield NOT_FOUND, not an error a UI could misread as 'valid'", async function () {
      const { registry } = await loadFixture(deployFixture);
      for (const id of [0n, 1n, 999999n]) {
        const [, status] = await registry.verifyCertificate(id);
        expect(status).to.equal(0);
      }
    });

    it("getCertificate on an admin ID reverts (no cross-type data leak)", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const adminId = await registry.adminWalletToTokenId(issuer.address);
      await expect(registry.getCertificate(adminId)).to.be.revertedWithCustomError(
        registry,
        "NotACertificate"
      );
    });
  });

  // ---------- Frontend-assumption bypasses ----------
  describe("Frontend assumption bypasses", function () {
    it("a client cannot 'verify' by calling a write function — verification is view-only", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "S", "C", "I", CID_V0);
      await tx.wait();
      const ids = await registry.getCertificatesByOwner(STUDENT);
      // verifyCertificate is a view: no state change possible via it.
      const before = await registry.getCertificate(ids[0]);
      await registry.verifyCertificate(ids[0]);
      const after = await registry.getCertificate(ids[0]);
      expect(after.valid).to.equal(before.valid);
    });

    it("tampered metadata cannot be written after issuance (no update path exists)", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "Original Name", "Course", "InstiChain", CID_V0);
      await tx.wait();
      const ids = await registry.getCertificatesByOwner(STUDENT);
      // There is no function to mutate certificate fields; only revocation exists.
      const cert = await registry.getCertificate(ids[0]);
      expect(cert.studentName).to.equal("Original Name");
    });

    it("re-issuance creates a new ID; it cannot overwrite an existing certificate", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const t1 = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "S", "C", "I", CID_V0);
      await t1.wait();
      const t2 = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "S2", "C", "I", CID_V0);
      await t2.wait();
      const ids = await registry.getCertificatesByOwner(STUDENT);
      expect(ids.length).to.equal(2);
      expect((await registry.getCertificate(ids[0])).studentName).to.equal("S");
      expect((await registry.getCertificate(ids[1])).studentName).to.equal("S2");
    });
  });

  // ---------- Repeated state transitions ----------
  describe("Repeated state transitions", function () {
    it("authorize -> remove -> re-authorize works and mints a fresh admin NFT", async function () {
      const { registry, owner, issuer } = await loadFixture(deployFixture);
      const firstId = await registry.adminWalletToTokenId(issuer.address);
      await registry.connect(owner).removeIssuer(issuer.address);
      const tx = await registry
        .connect(owner)
        .authorizeIssuer(issuer.address, "Alice 2.0", "Robotics Club");
      await tx.wait();
      const secondId = await registry.adminWalletToTokenId(issuer.address);
      expect(secondId).to.be.greaterThan(firstId);
      expect(await registry.ownerOf(secondId)).to.equal(issuer.address);
      // Can issue again after re-authorization
      const t = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "S", "C", "I", CID_V0);
      await expect(t).to.not.be.reverted;
    });

    it("issuance continues correctly after an issuer removal (no counter corruption)", async function () {
      const { registry, owner, issuer, attacker, student1 } = await loadFixture(deployFixture);
      const t1 = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "S", "C", "I", CID_V0);
      await t1.wait();
      await registry.connect(owner).removeIssuer(issuer.address);
      await registry.connect(owner).authorizeIssuer(attacker.address, "B", "C");
      const t2 = await registry
        .connect(attacker)
        .issueCertificate(student1.address, "S2", "C", "I", CID_V0);
      await t2.wait();
      // Deterministic ID ledger: admin NFT=0, cert=1 (STUDENT), attacker's new
      // admin NFT=2 (burned IDs are not reused), cert=3 (student1).
      const idsBefore = await registry.getCertificatesByOwner(STUDENT);
      const idsAfter = await registry.getCertificatesByOwner(student1.address);
      expect(idsBefore).to.deep.equal([1n]);
      expect(idsAfter).to.deep.equal([3n]);
      expect(await registry.getTotalTokenCount()).to.equal(4n);
    });
  });
});
