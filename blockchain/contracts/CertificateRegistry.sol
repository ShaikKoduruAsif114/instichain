// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CertificateRegistry
 * @dev Blockchain-based certificate verification system
 * - Issues Soulbound certificates (non-transferable NFTs)
 * - Stores certificate metadata on-chain
 * - Allows verification and revocation by issuers
 * - IPFS integration for PDF storage
 */
contract CertificateRegistry is ERC721, ERC721Enumerable, Ownable {
    // =================== DATA STRUCTURES ===================
    
    /**
     * @dev Contains metadata for each certificate
     */
    struct Certificate {
        string studentName;              // Full name of certificate recipient
        string course;                   // Course or credential title
        string issuer;                   // Name of issuing institution
        string ipfsHash;                 // IPFS hash of certificate PDF
        uint256 issueDate;               // Unix timestamp of issue date
        bool valid;                      // Whether certificate is still valid (not revoked)
        address issuerAddress;           // Address that issued the certificate
    }

    // =================== STATE VARIABLES ===================
    
    /// @dev Counter for certificate IDs
    uint256 public certificateCount = 0;

    /// @dev Mapping from token ID to certificate metadata
    mapping(uint256 => Certificate) public certificates;

    /// @dev Mapping from student address to list of certificate IDs
    mapping(address => uint256[]) public studentCertificates;

    /// @dev Mapping to track authorized issuers
    mapping(address => bool) public authorizedIssuers;

    // =================== EVENTS ===================
    
    /**
     * @dev Emitted when a new certificate is issued
     */
    event CertificateIssued(
        uint256 indexed certificateId,
        address indexed studentAddress,
        string studentName,
        string course,
        string issuer,
        string ipfsHash,
        uint256 issueDate
    );

    /**
     * @dev Emitted when a certificate is revoked
     */
    event CertificateRevoked(
        uint256 indexed certificateId,
        address indexed issuerAddress
    );

    /**
     * @dev Emitted when an issuer is authorized
     */
    event IssuerAuthorized(address indexed issuerAddress);

    /**
     * @dev Emitted when an issuer is removed
     */
    event IssuerRemoved(address indexed issuerAddress);

    // =================== MODIFIERS ===================
    
    /**
     * @dev Only owner can manage issuer access
     */
    modifier onlyOwnerOrIssuer(uint256 _certificateId) {
        require(
            msg.sender == owner() || msg.sender == certificates[_certificateId].issuerAddress,
            "Only owner or issuer can revoke"
        );
        _;
    }

    // =================== CONSTRUCTOR ===================
    
    constructor() ERC721("BlockchainCertificate", "CERT") Ownable(msg.sender) {
        // Owner is authorized by default
        authorizedIssuers[msg.sender] = true;
    }

    // =================== ISSUER MANAGEMENT ===================
    
    /**
     * @dev Authorize an address to issue certificates
     * @param _issuer Address of the institution to authorize
     */
    function authorizeIssuer(address _issuer) external onlyOwner {
        require(_issuer != address(0), "Invalid issuer address");
        authorizedIssuers[_issuer] = true;
        emit IssuerAuthorized(_issuer);
    }

    /**
     * @dev Remove issuer authorization
     * @param _issuer Address of the issuer to remove
     */
    function removeIssuer(address _issuer) external onlyOwner {
        authorizedIssuers[_issuer] = false;
        emit IssuerRemoved(_issuer);
    }

    // =================== CORE FUNCTIONS ===================
    
    /**
     * @dev Issue a new certificate to a student
     * @param _studentAddress Address of the student receiving the certificate
     * @param _studentName Full name of the student
     * @param _course Name of the course/credential
     * @param _issuer Name of the issuing institution
     * @param _ipfsHash IPFS hash of the certificate PDF
     * @return certificateId The ID of the newly issued certificate
     */
    function issueCertificate(
        address _studentAddress,
        string memory _studentName,
        string memory _course,
        string memory _issuer,
        string memory _ipfsHash
    ) external returns (uint256) {
        require(_studentAddress != address(0), "Invalid student address");
        require(authorizedIssuers[msg.sender], "Issuer not authorized");
        require(bytes(_studentName).length > 0, "Student name required");
        require(bytes(_course).length > 0, "Course name required");
        require(bytes(_issuer).length > 0, "Issuer name required");
        require(bytes(_ipfsHash).length > 0, "IPFS hash required");

        uint256 certificateId = certificateCount++;

        // Create certificate metadata
        certificates[certificateId] = Certificate({
            studentName: _studentName,
            course: _course,
            issuer: _issuer,
            ipfsHash: _ipfsHash,
            issueDate: block.timestamp,
            valid: true,
            issuerAddress: msg.sender
        });

        // Track certificate for student
        studentCertificates[_studentAddress].push(certificateId);

        // Mint Soulbound NFT to student
        _safeMint(_studentAddress, certificateId);

        emit CertificateIssued(
            certificateId,
            _studentAddress,
            _studentName,
            _course,
            _issuer,
            _ipfsHash,
            block.timestamp
        );

        return certificateId;
    }

    /**
     * @dev Verify a certificate
     * @param _certificateId ID of the certificate to verify
     * @return certificate The certificate metadata
     * @return isValid True if certificate is valid (not revoked)
     */
    function verifyCertificate(uint256 _certificateId)
        external
        view
        returns (Certificate memory certificate, bool isValid)
    {
        require(_certificateId < certificateCount, "Certificate does not exist");
        Certificate memory cert = certificates[_certificateId];
        return (cert, cert.valid);
    }

    /**
     * @dev Revoke a certificate (mark as invalid)
     * @param _certificateId ID of the certificate to revoke
     */
    function revokeCertificate(uint256 _certificateId) external onlyOwnerOrIssuer(_certificateId) {
        require(_certificateId < certificateCount, "Certificate does not exist");
        require(certificates[_certificateId].valid, "Certificate already revoked");

        certificates[_certificateId].valid = false;
        emit CertificateRevoked(_certificateId, msg.sender);
    }

    // =================== CERTIFICATE QUERIES ===================
    
    /**
     * @dev Get all certificates for a student
     * @param _studentAddress Address of the student
     * @return Array of certificate IDs
     */
    function getCertificatesByOwner(address _studentAddress)
        external
        view
        returns (uint256[] memory)
    {
        return studentCertificates[_studentAddress];
    }

    /**
     * @dev Get total number of certificates issued
     */
    function getTotalCertificateCount() external view returns (uint256) {
        return certificateCount;
    }

    /**
     * @dev Get certificate details
     * @param _certificateId ID of the certificate
     */
    function getCertificate(uint256 _certificateId)
        external
        view
        returns (Certificate memory)
    {
        require(_certificateId < certificateCount, "Certificate does not exist");
        return certificates[_certificateId];
    }

    // =================== SOULBOUND ENFORCEMENT (Non-Transferable) ===================
    
    /**
     * @dev Override transfer to prevent any transfers (Soulbound)
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        address from = _ownerOf(tokenId);
        
        // Prevent transfers after minting
        if (from != address(0) && to != address(0)) {
            revert("Certificates are Soulbound and cannot be transferred");
        }
        
        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Override supportsInterface for ERC721 compatibility
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev Override _increaseBalance for ERC721Enumerable
     */
    function _increaseBalance(address account, uint128 amount)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, amount);
    }
}
