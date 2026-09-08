/**
 * CertificateRegistry — core behavior tests
 *
 * Covers: deployment, issuer authorization, issuance, batch issuance,
 * revocation, soulbound enforcement, edge cases, and event correctness.
 *
 * Run: npx hardhat test test/CertificateRegistry.test.js
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Deterministic fixtures
const CID_V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtSgPgvodDkJZj2oG6MqX"; // 46 chars
const CID_V1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"; // 68 chars
const STUDENT = "0x000000000000000000000000000000000000dEaD";
const ZERO = ethers.ZeroAddress;

async function deployFixture() {
  const [owner, issuer, other, student1, student2] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Factory.deploy();
  await registry.waitForDeployment();

  // Authorize `issuer` with an admin NFT
  const authTx = await registry
    .connect(owner)
    .authorizeIssuer(issuer.address, "Alice Admin", "Robotics Club");
  await authTx.wait();

  return { registry, owner, issuer, other, student1, student2 };
}

async function issueOne(registry, issuer, student = STUDENT) {
  const tx = await registry
    .connect(issuer)
    .issueCertificate(student, "Student One", "Solidity 101", "InstiChain", CID_V0);
  const rcpt = await tx.wait();
  const event = rcpt.logs
    .map((l) => {
      try {
        return registry.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p) => p && p.name === "CertificateIssued");
  return { id: event.args.certificateId, receipt: rcpt };
}

describe("CertificateRegistry", function () {
  // =================== A. DEPLOYMENT ===================
  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("starts with zero tokens and owner pre-authorized", async function () {
      // Deploy a fresh registry (the shared fixture authorizes an issuer,
      // which mints admin NFT #0, so it cannot be used for this assertion).
      const [owner, other] = await ethers.getSigners();
      const Factory = await ethers.getContractFactory("CertificateRegistry");
      const fresh = await Factory.deploy();
      await fresh.waitForDeployment();
      expect(await fresh.tokenCount()).to.equal(0n);
      expect(await fresh.authorizedIssuers(owner.address)).to.equal(true);
      expect(await fresh.authorizedIssuers(other.address)).to.equal(false);
    });

    it("has correct ERC721 name/symbol", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.name()).to.equal("BlockchainCertificate");
      expect(await registry.symbol()).to.equal("CERT");
    });
  });

  // =================== B. ISSUER AUTHORIZATION ===================
  describe("Issuer authorization", function () {
    it("owner can authorize an issuer (mints admin NFT)", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(owner)
        .authorizeIssuer(other.address, "Bob", "Chess Club");
      const rcpt = await tx.wait();

      expect(await registry.authorizedIssuers(other.address)).to.equal(true);
      const tokenId = await registry.adminWalletToTokenId(other.address);
      expect(await registry.ownerOf(tokenId)).to.equal(other.address);

      const parsed = rcpt.logs
        .map((l) => {
          try {
            return registry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p) => p && p.name === "IssuerAuthorized");
      expect(parsed).to.not.be.undefined;
      expect(parsed.args.issuerAddress).to.equal(other.address);
      expect(parsed.args.adminName).to.equal("Bob");
      expect(parsed.args.clubName).to.equal("Chess Club");
    });

    it("non-owner cannot authorize an issuer", async function () {
      const { registry, other, student1 } = await loadFixture(deployFixture);
      await expect(
        registry
          .connect(other)
          .authorizeIssuer(student1.address, "X", "Y")
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("duplicate authorization reverts", async function () {
      const { registry, owner, issuer } = await loadFixture(deployFixture);
      await expect(
        registry.connect(owner).authorizeIssuer(issuer.address, "A", "B")
      ).to.be.revertedWithCustomError(registry, "IssuerAlreadyAuthorized");
    });

    it("zero-address issuer reverts", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      await expect(
        registry.connect(owner).authorizeIssuer(ZERO, "A", "B")
      ).to.be.revertedWithCustomError(registry, "InvalidAddress");
    });

    it("empty admin name reverts", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);
      await expect(
        registry.connect(owner).authorizeIssuer(other.address, "", "B")
      ).to.be.revertedWithCustomError(registry, "EmptyString");
    });

    it("removed issuer can no longer issue", async function () {
      const { registry, owner, issuer, student1 } = await loadFixture(deployFixture);
      await registry.connect(owner).removeIssuer(issuer.address);
      expect(await registry.authorizedIssuers(issuer.address)).to.equal(false);
      await expect(
        registry
          .connect(issuer)
          .issueCertificate(student1.address, "S", "C", "I", CID_V0)
      ).to.be.revertedWithCustomError(registry, "IssuerNotAuthorized");
    });

    it("removal burns the admin NFT and emits IssuerRemoved", async function () {
      const { registry, owner, issuer } = await loadFixture(deployFixture);
      const tokenId = await registry.adminWalletToTokenId(issuer.address);
      const tx = await registry.connect(owner).removeIssuer(issuer.address);
      const rcpt = await tx.wait();

      // Admin NFT burned
      await expect(registry.ownerOf(tokenId)).to.be.revertedWithCustomError(
        registry,
        "ERC721NonexistentToken"
      );
      const parsed = rcpt.logs
        .map((l) => {
          try {
            return registry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p) => p && p.name === "IssuerRemoved");
      expect(parsed).to.not.be.undefined;
      expect(parsed.args.issuerAddress).to.equal(issuer.address);
      expect(parsed.args.tokenId).to.equal(tokenId);
    });

    it("removing a non-authorized issuer reverts", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);
      await expect(
        registry.connect(owner).removeIssuer(other.address)
      ).to.be.revertedWithCustomError(registry, "IssuerNotAuthorized");
    });

    it("non-owner cannot remove an issuer", async function () {
      const { registry, issuer, other } = await loadFixture(deployFixture);
      await expect(
        registry.connect(other).removeIssuer(issuer.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });

  // =================== C. CERTIFICATE ISSUANCE ===================
  describe("Certificate issuance", function () {
    it("authorized issuer can issue; data stored correctly", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer);

      const cert = await registry.getCertificate(id);
      expect(cert.studentName).to.equal("Student One");
      expect(cert.course).to.equal("Solidity 101");
      expect(cert.issuer).to.equal("InstiChain");
      expect(cert.ipfsHash).to.equal(CID_V0);
      expect(cert.valid).to.equal(true);
      expect(cert.issuerAddress).to.equal(issuer.address);
      expect(cert.issueDate).to.be.greaterThan(0n);

      // Ownership + student index
      expect(await registry.ownerOf(id)).to.equal(STUDENT);
      const list = await registry.getCertificatesByOwner(STUDENT);
      expect(list).to.deep.equal([id]);
    });

    it("unauthorized address cannot issue", async function () {
      const { registry, other, student1 } = await loadFixture(deployFixture);
      await expect(
        registry
          .connect(other)
          .issueCertificate(student1.address, "S", "C", "I", CID_V0)
      ).to.be.revertedWithCustomError(registry, "IssuerNotAuthorized");
    });

    it("zero student address reverts", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(
        registry.connect(issuer).issueCertificate(ZERO, "S", "C", "I", CID_V0)
      ).to.be.revertedWithCustomError(registry, "InvalidAddress");
    });

    it("empty name/course/issuer reverts with EmptyString", async function () {
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

    it("invalid CID reverts (short, long, wrong prefix)", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(
        registry.connect(issuer).issueCertificate(STUDENT, "S", "C", "I", "QmShort")
      ).to.be.revertedWithCustomError(registry, "InvalidCID");
      await expect(
        registry
          .connect(issuer)
          .issueCertificate(STUDENT, "S", "C", "I", "Qm" + "a".repeat(60))
      ).to.be.revertedWithCustomError(registry, "InvalidCID");
      await expect(
        registry
          .connect(issuer)
          .issueCertificate(STUDENT, "S", "C", "I", "zz" + "a".repeat(50))
      ).to.be.revertedWithCustomError(registry, "InvalidCID");
      await expect(
        registry.connect(issuer).issueCertificate(STUDENT, "S", "C", "I", "")
      ).to.be.revertedWithCustomError(registry, "InvalidCID");
    });

    it("accepts CIDv1 (bafy...) hashes", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "S", "C", "I", CID_V1);
      await expect(tx).to.not.be.reverted;
    });

    it("emits CertificateIssued with correct indexed fields", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const tx = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "Student One", "Solidity 101", "InstiChain", CID_V0);
      await expect(tx).to.emit(registry, "CertificateIssued");
      const rcpt = await tx.wait();
      const parsed = rcpt.logs
        .map((l) => {
          try {
            return registry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((p) => p && p.name === "CertificateIssued");
      expect(parsed.args.studentAddress).to.equal(STUDENT);
      expect(parsed.args.studentName).to.equal("Student One");
      expect(parsed.args.course).to.equal("Solidity 101");
      expect(parsed.args.issuer).to.equal("InstiChain");
      expect(parsed.args.ipfsHash).to.equal(CID_V0);
      expect(parsed.args.issueDate).to.be.greaterThan(0n);
      expect(parsed.args.certificateId).to.equal(1n); // 0 = admin NFT
    });

    it("consecutive issues get sequential IDs", async function () {
      const { registry, issuer, student1, student2 } = await loadFixture(deployFixture);
      const a = await issueOne(registry, issuer, student1.address);
      const b = await issueOne(registry, issuer, student2.address);
      expect(b.id).to.equal(a.id + 1n);
    });
  });

  // =================== D. BATCH ISSUANCE ===================
  describe("Batch issuance", function () {
    const makeBatch = (n) => ({
      addrs: Array.from({ length: n }, (_, i) => ethers.Wallet.createRandom().address),
      names: Array.from({ length: n }, (_, i) => `Student ${i}`),
      courses: Array.from({ length: n }, () => "Course"),
      issuers: Array.from({ length: n }, () => "InstiChain"),
      cids: Array.from({ length: n }, () => CID_V0),
    });

    it("valid batch of 5 mints 5 certificates with correct data", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const b = makeBatch(5);
      const tx = await registry
        .connect(issuer)
        .batchIssueCertificates(b.addrs, b.names, b.courses, b.issuers, b.cids);
      const rcpt = await tx.wait();

      const events = rcpt.logs
        .map((l) => {
          try {
            return registry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .filter((p) => p && p.name === "CertificateIssued");
      expect(events.length).to.equal(5);

      const firstId = events[0].args.certificateId;
      for (let i = 0; i < 5; i++) {
        const id = firstId + BigInt(i);
        const cert = await registry.getCertificate(id);
        expect(cert.studentName).to.equal(b.names[i]);
        expect(cert.issuerAddress).to.equal(issuer.address);
        expect(await registry.ownerOf(id)).to.equal(b.addrs[i]);
      }
    });

    it("emits one CertificateIssued per entry with correct indexed student", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const b = makeBatch(3);
      const tx = await registry
        .connect(issuer)
        .batchIssueCertificates(b.addrs, b.names, b.courses, b.issuers, b.cids);
      const rcpt = await tx.wait();
      const events = rcpt.logs
        .map((l) => {
          try {
            return registry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .filter((p) => p && p.name === "CertificateIssued");
      for (let i = 0; i < 3; i++) {
        expect(events[i].args.studentAddress).to.equal(b.addrs[i]);
      }
    });

    it("empty batch reverts", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      await expect(
        registry
          .connect(issuer)
          .batchIssueCertificates([], [], [], [], [])
      ).to.be.revertedWithCustomError(registry, "EmptyBatch");
    });

    it("mismatched array lengths revert", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const b = makeBatch(3);
      await expect(
        registry
          .connect(issuer)
          .batchIssueCertificates(b.addrs, b.names.slice(0, 2), b.courses, b.issuers, b.cids)
      ).to.be.revertedWithCustomError(registry, "MismatchedArrayLengths");
    });

    it("batch over MAX_BATCH_SIZE reverts", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const max = Number(await registry.MAX_BATCH_SIZE());
      const b = makeBatch(max + 1);
      await expect(
        registry
          .connect(issuer)
          .batchIssueCertificates(b.addrs, b.names, b.courses, b.issuers, b.cids)
      ).to.be.revertedWithCustomError(registry, "BatchTooLarge");
    });

    it("unauthorized batch issuance reverts", async function () {
      const { registry, other } = await loadFixture(deployFixture);
      const b = makeBatch(2);
      await expect(
        registry
          .connect(other)
          .batchIssueCertificates(b.addrs, b.names, b.courses, b.issuers, b.cids)
      ).to.be.revertedWithCustomError(registry, "IssuerNotAuthorized");
    });

    it("batch with a zero address reverts atomically (no partial state)", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const b = makeBatch(3);
      b.addrs[1] = ZERO;
      const before = await registry.tokenCount();
      await expect(
        registry
          .connect(issuer)
          .batchIssueCertificates(b.addrs, b.names, b.courses, b.issuers, b.cids)
      ).to.be.revertedWithCustomError(registry, "InvalidAddress");
      expect(await registry.tokenCount()).to.equal(before);
    });

    it("batch with an invalid CID reverts atomically", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const b = makeBatch(2);
      b.cids[1] = "not-a-cid";
      const before = await registry.tokenCount();
      await expect(
        registry
          .connect(issuer)
          .batchIssueCertificates(b.addrs, b.names, b.courses, b.issuers, b.cids)
      ).to.be.revertedWithCustomError(registry, "InvalidCID");
      expect(await registry.tokenCount()).to.equal(before);
    });
  });

  // =================== E. REVOCATION ===================
  describe("Revocation", function () {
    it("issuing address can revoke their own certificate", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer);
      const tx = await registry.connect(issuer).revokeCertificate(id);
      await expect(tx).to.emit(registry, "CertificateRevoked").withArgs(id, issuer.address);
      const cert = await registry.getCertificate(id);
      expect(cert.valid).to.equal(false);
    });

    it("owner can revoke any certificate", async function () {
      const { registry, owner, issuer } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer);
      const tx = await registry.connect(owner).revokeCertificate(id);
      await expect(tx).to.emit(registry, "CertificateRevoked").withArgs(id, owner.address);
      expect((await registry.getCertificate(id)).valid).to.equal(false);
    });

    it("unrelated address cannot revoke", async function () {
      const { registry, other, issuer } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer);
      await expect(
        registry.connect(other).revokeCertificate(id)
      ).to.be.revertedWithCustomError(registry, "NotAuthorizedToRevoke");
    });

    it("revoking a non-existent certificate reverts", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      await expect(
        registry.connect(owner).revokeCertificate(9999n)
      ).to.be.revertedWithCustomError(registry, "TokenDoesNotExist");
    });

    it("repeated revocation reverts with AlreadyRevoked", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer);
      await registry.connect(issuer).revokeCertificate(id);
      await expect(
        registry.connect(issuer).revokeCertificate(id)
      ).to.be.revertedWithCustomError(registry, "AlreadyRevoked");
    });

    it("revoking an admin-token ID reverts with NotACertificate", async function () {
      const { registry, owner, issuer } = await loadFixture(deployFixture);
      const adminId = await registry.adminWalletToTokenId(issuer.address);
      await expect(
        registry.connect(owner).revokeCertificate(adminId)
      ).to.be.revertedWithCustomError(registry, "NotACertificate");
    });

    it("revoked certificate is persisted and reflected in verifyCertificate", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer);
      await registry.connect(issuer).revokeCertificate(id);
      const [cert, status] = await registry.verifyCertificate(id);
      expect(status).to.equal(2); // REVOKED
      expect(cert.valid).to.equal(false);
    });
  });

  // =================== F. SOULBOUND BEHAVIOR ===================
  describe("Soulbound enforcement", function () {
    it("transferFrom reverts", async function () {
      const { registry, issuer, student1, student2 } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer, student1.address);
      await expect(
        registry.connect(student1).transferFrom(student1.address, student2.address, id)
      ).to.be.revertedWithCustomError(registry, "SoulboundTransfer");
    });

    it("safeTransferFrom reverts", async function () {
      const { registry, issuer, student1, student2 } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer, student1.address);
      await expect(
        registry
          .connect(student1)
          .safeTransferFrom(student1.address, student2.address, id)
      ).to.be.revertedWithCustomError(registry, "SoulboundTransfer");
    });

    it("approve reverts (approvals disabled)", async function () {
      const { registry, issuer, student1, student2 } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer, student1.address);
      await expect(
        registry.connect(student1).approve(student2.address, id)
      ).to.be.revertedWithCustomError(registry, "ApprovalsDisabled");
    });

    it("setApprovalForAll reverts", async function () {
      const { registry, issuer, student1, student2 } = await loadFixture(deployFixture);
      await issueOne(registry, issuer, student1.address);
      await expect(
        registry.connect(student1).setApprovalForAll(student2.address, true)
      ).to.be.revertedWithCustomError(registry, "ApprovalsDisabled");
    });

    it("admin NFTs are also non-transferable", async function () {
      const { registry, owner, issuer, student1 } = await loadFixture(deployFixture);
      const adminId = await registry.adminWalletToTokenId(issuer.address);
      await expect(
        registry.connect(issuer).transferFrom(issuer.address, student1.address, adminId)
      ).to.be.revertedWithCustomError(registry, "SoulboundTransfer");
    });
  });

  // =================== G. EDGE CASES ===================
  describe("Edge cases", function () {
    it("verifyCertificate returns NOT_FOUND for out-of-range IDs (no revert)", async function () {
      const { registry } = await loadFixture(deployFixture);
      const [, status] = await registry.verifyCertificate(0n);
      expect(status).to.equal(0); // NOT_FOUND
      const [, status2] = await registry.verifyCertificate(12345n);
      expect(status2).to.equal(0);
    });

    it("verifyCertificate returns NOT_FOUND for admin-token IDs", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const adminId = await registry.adminWalletToTokenId(issuer.address);
      const [, status] = await registry.verifyCertificate(adminId);
      expect(status).to.equal(0);
    });

    it("verifyCertificate returns VALID for a live certificate", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer);
      const [cert, status] = await registry.verifyCertificate(id);
      expect(status).to.equal(1); // VALID
      expect(cert.studentName).to.equal("Student One");
    });

    it("getCertificate reverts for admin-token IDs", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const adminId = await registry.adminWalletToTokenId(issuer.address);
      await expect(registry.getCertificate(adminId)).to.be.revertedWithCustomError(
        registry,
        "NotACertificate"
      );
    });

    it("verifyAdminByWallet is non-reverting for unknown addresses", async function () {
      const { registry, other } = await loadFixture(deployFixture);
      const [, isValid] = await registry.verifyAdminByWallet(other.address);
      expect(isValid).to.equal(false);
    });

    it("verifyAdminByWallet reports owner as active (no admin NFT)", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      const [, isValid] = await registry.verifyAdminByWallet(owner.address);
      expect(isValid).to.equal(true);
    });

    it("verifyAdminToken reverts for certificate IDs", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const { id } = await issueOne(registry, issuer);
      await expect(registry.verifyAdminToken(id)).to.be.revertedWithCustomError(
        registry,
        "NotAnAdminToken"
      );
    });

    it("student can hold multiple certificates from different issuers", async function () {
      const { registry, owner, issuer, other, student1 } = await loadFixture(deployFixture);
      await registry.connect(owner).authorizeIssuer(other.address, "C", "D");
      const a = await issueOne(registry, issuer, student1.address);
      const b = await issueOne(registry, other, student1.address);
      const list = await registry.getCertificatesByOwner(student1.address);
      expect(list).to.deep.equal([a.id, b.id]);
    });

    it("unusual but valid long CIDv1 is accepted", async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const longCid = "b" + "a".repeat(127); // 128 chars total
      const tx = await registry
        .connect(issuer)
        .issueCertificate(STUDENT, "S", "C", "I", longCid);
      await expect(tx).to.not.be.reverted;
    });

    it("tokenCount tracks all mints after mixed mints", async function () {
      const { registry, issuer, student1 } = await loadFixture(deployFixture);
      await issueOne(registry, issuer, student1.address);
      await issueOne(registry, issuer, student1.address);
      // 1 admin NFT (issuer) + 2 certificates
      expect(await registry.getTotalTokenCount()).to.equal(3n);
      expect(await registry.balanceOf(student1.address)).to.equal(2n);
      expect(await registry.balanceOf(issuer.address)).to.equal(1n);
    });
  });
});
