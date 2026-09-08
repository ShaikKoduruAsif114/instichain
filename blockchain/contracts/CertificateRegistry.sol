// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CertificateRegistry
 * @notice Soulbound (non-transferable) ERC-721 credential registry.
 *
 * Model:
 *  - The contract owner authorizes institution/club issuers. Each authorized
 *    issuer receives a soulbound "Admin" NFT (token ID from the shared counter).
 *  - Authorized issuers mint soulbound certificate NFTs to student addresses.
 *  - Certificates can be revoked by the issuing address or the contract owner.
 *  - All tokens (admin + certificates) are non-transferable: any transfer,
 *    approval, or operator grant reverts.
 *  - Certificate metadata (including an IPFS CID for the PDF) is stored on-chain.
 *
 * Note: ERC721Enumerable is intentionally NOT used — no product flow needs
 * index-based enumeration (per-holder lookups use studentCertificates), and
 * dropping it saves ~8k gas per mint.
 *
 * Verification is a pure view: `verifyCertificate` never reverts for a
 * non-existent ID — it returns an explicit `VerificationStatus` so verifiers
 * can distinguish NOT_FOUND / VALID / REVOKED.
 */
contract CertificateRegistry is ERC721, Ownable {
    // =================== TYPES ===================

    struct AdminToken {
        string adminName;
        string clubName;
        uint256 issueDate;
        bool valid;
    }

    struct Certificate {
        string studentName;
        string course;
        string issuer;
        string ipfsHash;
        uint256 issueDate;
        bool valid;
        address issuerAddress;
    }

    /// @dev Explicit verification outcome so callers never confuse
    ///      "not found" with "revoked" or with a transport error.
    enum VerificationStatus {
        NOT_FOUND, // id does not exist or is not a certificate
        VALID, // exists and not revoked
        REVOKED // exists but revoked
    }

    // =================== CUSTOM ERRORS ===================

    error InvalidAddress(string param);
    error EmptyString(string param);
    error InvalidCID(string cid);
    error IssuerAlreadyAuthorized(address issuer);
    error IssuerNotAuthorized(address issuer);
    error TokenDoesNotExist(uint256 tokenId);
    error NotACertificate(uint256 tokenId);
    error NotAnAdminToken(uint256 tokenId);
    error AlreadyRevoked(uint256 certificateId);
    error NotAuthorizedToRevoke(uint256 certificateId, address caller);
    error EmptyBatch();
    error MismatchedArrayLengths(uint256 expected, uint256 actual);
    error BatchTooLarge(uint256 length, uint256 max);
    error SoulboundTransfer(uint256 tokenId);
    error ApprovalsDisabled();

    // =================== CONSTANTS ===================

    /// @dev Hard cap on certificates per batch transaction.
    ///      Measured (see benchmarks/gas-benchmark.json): a batch costs
    ///      ~288k gas per certificate with realistic metadata. At the old cap
    ///      of 100, one batch approached ~29M gas — beyond the 30M block gas
    ///      limit used by Ethereum mainnet and Polygon (transaction "ran out
    ///      of gas" when benchmarked). 50 keeps a full batch ≈ 14.4M gas,
    ///      safely inside a 30M block, and bounds worst-case revert cost.
    uint256 public constant MAX_BATCH_SIZE = 50;

    /// @dev CID length bounds (CIDv0 = 46 chars; CIDv1 base32 up to ~128).
    uint256 private constant CID_MIN_LEN = 40;
    uint256 private constant CID_MAX_LEN = 128;

    // =================== STATE ===================

    /// @dev Shared monotonic counter for admin-token and certificate IDs.
    uint256 public tokenCount = 0;

    /// @dev tokenId => admin metadata (admin tokens only)
    mapping(uint256 => AdminToken) public adminTokens;

    /// @dev tokenId => certificate metadata (certificates only)
    mapping(uint256 => Certificate) public certificates;

    /// @dev student address => certificate IDs held
    mapping(address => uint256[]) public studentCertificates;

    /// @dev address => whether the address may issue certificates
    mapping(address => bool) public authorizedIssuers;

    /// @dev issuer address => their admin NFT token id (0 if none minted)
    mapping(address => uint256) public adminWalletToTokenId;

    // =================== EVENTS ===================

    event CertificateIssued(
        uint256 indexed certificateId,
        address indexed studentAddress,
        string studentName,
        string course,
        string issuer,
        string ipfsHash,
        uint256 issueDate
    );

    event CertificateRevoked(
        uint256 indexed certificateId,
        address indexed revokedBy
    );

    event IssuerAuthorized(
        address indexed issuerAddress,
        uint256 indexed tokenId,
        string adminName,
        string clubName
    );

    event IssuerRemoved(
        address indexed issuerAddress,
        uint256 indexed tokenId
    );

    // =================== MODIFIERS ===================

    modifier onlyOwnerOrIssuer(uint256 _certificateId) {
        if (
            msg.sender != owner() &&
            msg.sender != certificates[_certificateId].issuerAddress
        ) {
            revert NotAuthorizedToRevoke(_certificateId, msg.sender);
        }
        _;
    }

    // =================== CONSTRUCTOR ===================

    constructor() ERC721("BlockchainCertificate", "CERT") Ownable(msg.sender) {
        // The deployer/owner may issue directly without an admin NFT.
        authorizedIssuers[msg.sender] = true;
    }

    // =================== ISSUER MANAGEMENT ===================

    /**
     * @notice Authorize an address as an issuer and mint them a soulbound Admin NFT.
     * @dev Only the contract owner. Reverts if already authorized.
     */
    function authorizeIssuer(
        address _issuer,
        string memory _adminName,
        string memory _clubName
    ) external onlyOwner {
        if (_issuer == address(0)) revert InvalidAddress("_issuer");
        if (bytes(_adminName).length == 0) revert EmptyString("_adminName");
        if (authorizedIssuers[_issuer]) {
            revert IssuerAlreadyAuthorized(_issuer);
        }

        uint256 tokenId = tokenCount++;

        adminTokens[tokenId] = AdminToken({
            adminName: _adminName,
            clubName: _clubName,
            issueDate: block.timestamp,
            valid: true
        });

        authorizedIssuers[_issuer] = true;
        adminWalletToTokenId[_issuer] = tokenId;

        _safeMint(_issuer, tokenId);

        emit IssuerAuthorized(_issuer, tokenId, _adminName, _clubName);
    }

    /**
     * @notice Remove issuer authorization and burn their Admin NFT.
     * @dev Only the contract owner. Certificates previously issued by this
     *      address remain on-chain and verifiable (revocation is separate).
     */
    function removeIssuer(address _issuer) external onlyOwner {
        if (!authorizedIssuers[_issuer]) {
            revert IssuerNotAuthorized(_issuer);
        }
        authorizedIssuers[_issuer] = false;

        uint256 tokenId = adminWalletToTokenId[_issuer];
        // Only invalidate/burn if this address actually holds a live admin NFT.
        // (The owner is authorized by default but holds no admin token, and
        // tokenId 0 is a legitimate ID for the first authorized issuer.)
        if (_ownerOf(tokenId) != address(0) && ownerOf(tokenId) == _issuer) {
            adminTokens[tokenId].valid = false;
            _burn(tokenId);
        }

        emit IssuerRemoved(_issuer, tokenId);
    }

    /**
     * @notice Verify an Admin NFT by token ID.
     * @dev Reverts only if the ID does not exist or is not an admin token.
     */
    function verifyAdminToken(
        uint256 _tokenId
    ) external view returns (AdminToken memory adminToken, bool isValid) {
        if (_tokenId >= tokenCount) revert TokenDoesNotExist(_tokenId);
        AdminToken memory token = adminTokens[_tokenId];
        if (bytes(token.adminName).length == 0) {
            revert NotAnAdminToken(_tokenId);
        }
        return (token, token.valid);
    }

    /**
     * @notice Verify an issuer by wallet address.
     * @dev Non-reverting: returns isValid=false for unknown/inactive issuers
     *      so verifiers get an explicit answer instead of a revert.
     */
    function verifyAdminByWallet(
        address _issuer
    ) external view returns (AdminToken memory adminToken, bool isValid) {
        if (!authorizedIssuers[_issuer]) {
            return (AdminToken("", "", 0, false), false);
        }
        uint256 tokenId = adminWalletToTokenId[_issuer];
        AdminToken memory token = adminTokens[tokenId];
        // Owner (no admin NFT) is active with empty metadata.
        return (token, token.valid || bytes(token.adminName).length == 0);
    }

    // =================== CORE: ISSUANCE ===================

    /**
     * @notice Issue a single soulbound certificate to a student.
     * @dev Only authorized issuers. Returns the new certificate ID.
     */
    function issueCertificate(
        address _studentAddress,
        string memory _studentName,
        string memory _course,
        string memory _issuer,
        string memory _ipfsHash
    ) external returns (uint256) {
        if (!authorizedIssuers[msg.sender]) {
            revert IssuerNotAuthorized(msg.sender);
        }
        if (_studentAddress == address(0)) revert InvalidAddress("_studentAddress");
        if (bytes(_studentName).length == 0) revert EmptyString("_studentName");
        if (bytes(_course).length == 0) revert EmptyString("_course");
        if (bytes(_issuer).length == 0) revert EmptyString("_issuer");
        _validateCID(_ipfsHash);

        uint256 certificateId = _mintCertificate(
            _studentAddress,
            _studentName,
            _course,
            _issuer,
            _ipfsHash
        );

        emit CertificateIssued(
            certificateId,
            _studentAddress,
            _studentName,
            _course,
            _issuer,
            _ipfsHash,
            certificates[certificateId].issueDate
        );

        return certificateId;
    }

    /**
     * @notice Issue up to {MAX_BATCH_SIZE} certificates in one transaction.
     * @dev All arrays must have identical length. The whole batch is atomic:
     *      any invalid entry reverts the entire transaction.
     * @return certificateIds IDs of the newly issued certificates, in order.
     */
    function batchIssueCertificates(
        address[] memory _studentAddresses,
        string[] memory _studentNames,
        string[] memory _courses,
        string[] memory _issuers,
        string[] memory _ipfsHashes
    ) external returns (uint256[] memory) {
        if (!authorizedIssuers[msg.sender]) {
            revert IssuerNotAuthorized(msg.sender);
        }

        uint256 length = _studentAddresses.length;
        if (length == 0) revert EmptyBatch();
        if (length > MAX_BATCH_SIZE) revert BatchTooLarge(length, MAX_BATCH_SIZE);
        if (length != _studentNames.length) {
            revert MismatchedArrayLengths(length, _studentNames.length);
        }
        if (length != _courses.length) {
            revert MismatchedArrayLengths(length, _courses.length);
        }
        if (length != _issuers.length) {
            revert MismatchedArrayLengths(length, _issuers.length);
        }
        if (length != _ipfsHashes.length) {
            revert MismatchedArrayLengths(length, _ipfsHashes.length);
        }

        uint256[] memory certificateIds = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            if (_studentAddresses[i] == address(0)) {
                revert InvalidAddress("_studentAddresses[i]");
            }
            if (bytes(_studentNames[i]).length == 0) {
                revert EmptyString("_studentNames[i]");
            }
            if (bytes(_courses[i]).length == 0) {
                revert EmptyString("_courses[i]");
            }
            if (bytes(_issuers[i]).length == 0) {
                revert EmptyString("_issuers[i]");
            }
            _validateCID(_ipfsHashes[i]);

            certificateIds[i] = _mintCertificate(
                _studentAddresses[i],
                _studentNames[i],
                _courses[i],
                _issuers[i],
                _ipfsHashes[i]
            );

            emit CertificateIssued(
                certificateIds[i],
                _studentAddresses[i],
                _studentNames[i],
                _courses[i],
                _issuers[i],
                _ipfsHashes[i],
                certificates[certificateIds[i]].issueDate
            );
        }

        return certificateIds;
    }

    // =================== CORE: REVOCATION ===================

    /**
     * @notice Revoke a certificate (mark invalid).
     * @dev Only the issuing address or the contract owner. Reverts if the
     *      certificate does not exist or is already revoked.
     */
    function revokeCertificate(uint256 _certificateId)
        external
        onlyOwnerOrIssuer(_certificateId)
    {
        if (_certificateId >= tokenCount) {
            revert TokenDoesNotExist(_certificateId);
        }
        Certificate storage cert = certificates[_certificateId];
        if (bytes(cert.studentName).length == 0) {
            revert NotACertificate(_certificateId);
        }
        if (!cert.valid) revert AlreadyRevoked(_certificateId);

        cert.valid = false;
        emit CertificateRevoked(_certificateId, msg.sender);
    }

    // =================== VERIFICATION / QUERIES ===================

    /**
     * @notice Verify a certificate by ID.
     * @dev Non-reverting for unknown IDs. Returns:
     *      - NOT_FOUND: id out of range, or id belongs to an admin token
     *      - VALID: certificate exists and is not revoked
     *      - REVOKED: certificate exists but has been revoked
     */
    function verifyCertificate(
        uint256 _certificateId
    ) external view returns (Certificate memory certificate, VerificationStatus status) {
        if (_certificateId >= tokenCount) {
            return (
                Certificate("", "", "", "", 0, false, address(0)),
                VerificationStatus.NOT_FOUND
            );
        }
        Certificate memory cert = certificates[_certificateId];
        if (bytes(cert.studentName).length == 0) {
            // ID belongs to an admin token, not a certificate.
            return (
                Certificate("", "", "", "", 0, false, address(0)),
                VerificationStatus.NOT_FOUND
            );
        }
        return (
            cert,
            cert.valid ? VerificationStatus.VALID : VerificationStatus.REVOKED
        );
    }

    /**
     * @notice Get all certificate IDs held by a student address.
     */
    function getCertificatesByOwner(
        address _studentAddress
    ) external view returns (uint256[] memory) {
        return studentCertificates[_studentAddress];
    }

    /**
     * @notice Total number of tokens (admin + certificates) ever minted.
     */
    function getTotalTokenCount() external view returns (uint256) {
        return tokenCount;
    }

    /**
     * @notice Get certificate details. Reverts if the ID is not a certificate.
     */
    function getCertificate(uint256 _certificateId)
        external
        view
        returns (Certificate memory)
    {
        if (_certificateId >= tokenCount) {
            revert TokenDoesNotExist(_certificateId);
        }
        Certificate memory cert = certificates[_certificateId];
        if (bytes(cert.studentName).length == 0) {
            revert NotACertificate(_certificateId);
        }
        return cert;
    }

    // =================== INTERNAL ===================

    function _mintCertificate(
        address _studentAddress,
        string memory _studentName,
        string memory _course,
        string memory _issuer,
        string memory _ipfsHash
    ) internal returns (uint256) {
        uint256 certificateId = tokenCount++;

        certificates[certificateId] = Certificate({
            studentName: _studentName,
            course: _course,
            issuer: _issuer,
            ipfsHash: _ipfsHash,
            issueDate: block.timestamp,
            valid: true,
            issuerAddress: msg.sender
        });

        studentCertificates[_studentAddress].push(certificateId);

        _safeMint(_studentAddress, certificateId);

        return certificateId;
    }

    /**
     * @dev Accepts CIDv0 ("Qm..." 46 chars) and CIDv1 base32 ("b...").
     *      Rejects empty, too-short, too-long, or obviously malformed values.
     */
    function _validateCID(string memory _cid) internal pure {
        bytes memory b = bytes(_cid);
        if (b.length < CID_MIN_LEN || b.length > CID_MAX_LEN) {
            revert InvalidCID(_cid);
        }
        if (b[0] == "Q" && b[1] == "m") {
            if (b.length != 46) revert InvalidCID(_cid);
            return;
        }
        if (b[0] == "b") {
            return;
        }
        revert InvalidCID(_cid);
    }

    // =================== SOULBOUND ENFORCEMENT ===================

    /**
     * @dev Block all transfers. Mints (from == 0) and burns (to == 0) are
     *      allowed internally; anything else reverts.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert SoulboundTransfer(tokenId);
        }
        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Approvals are meaningless for soulbound credentials and are
     *      disabled to keep the state surface minimal and unambiguous.
     */
    function approve(address, uint256) public pure override {
        revert ApprovalsDisabled();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert ApprovalsDisabled();
    }
}
