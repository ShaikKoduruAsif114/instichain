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
     * @dev Contains metadata for each Admin NFT
     */
    struct AdminToken {
        string adminName;
        string clubName;
        uint256 issueDate;
        bool valid;
    }

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
    
    /// @dev Counter for certificate IDs and Admin Token IDs (Admin IDs are prefixed with 1000000 for separation if needed, or just share the counter. Let's share.)
    uint256 public tokenCount = 0;

    /// @dev Mapping from token ID to admin metadata
    mapping(uint256 => AdminToken) public adminTokens;

    /// @dev Mapping from token ID to certificate metadata
    mapping(uint256 => Certificate) public certificates;

    /// @dev Mapping from student address to list of certificate IDs
    mapping(address => uint256[]) public studentCertificates;

    /// @dev Mapping to track authorized issuers (also tracks if they hold an Admin NFT)
    mapping(address => bool) public authorizedIssuers;
    
    /// @dev Mapping from admin address to their admin token ID
    mapping(address => uint256) public adminWalletToTokenId;

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
     * @dev Emitted when an issuer is authorized (Admin NFT Minted)
     */
    event IssuerAuthorized(address indexed issuerAddress, uint256 indexed tokenId, string adminName, string clubName);

    /**
     * @dev Emitted when an issuer is removed (Admin NFT Revoked)
     */
    event IssuerRemoved(address indexed issuerAddress, uint256 indexed tokenId);

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

    // =================== ISSUER MANAGEMENT (ADMIN NFTs) ===================
    
    /**
     * @dev Authorize an address to issue certificates and mint an Admin NFT
     * @param _issuer Address of the institution/admin to authorize
     * @param _adminName Name of the admin
     * @param _clubName Name of the club
     */
    function authorizeIssuer(address _issuer, string memory _adminName, string memory _clubName) external onlyOwner {
        require(_issuer != address(0), "Invalid issuer address");
        require(!authorizedIssuers[_issuer], "Issuer already authorized");
        
        uint256 tokenId = tokenCount++;

        adminTokens[tokenId] = AdminToken({
            adminName: _adminName,
            clubName: _clubName,
            issueDate: block.timestamp,
            valid: true
        });

        authorizedIssuers[_issuer] = true;
        adminWalletToTokenId[_issuer] = tokenId;

        // Mint Soulbound NFT to admin
        _safeMint(_issuer, tokenId);

        emit IssuerAuthorized(_issuer, tokenId, _adminName, _clubName);
    }

    /**
     * @dev Remove issuer authorization and revoke their Admin NFT
     * @param _issuer Address of the issuer to remove
     */
    function removeIssuer(address _issuer) external onlyOwner {
        require(authorizedIssuers[_issuer], "Issuer not authorized");
        authorizedIssuers[_issuer] = false;
        
        uint256 tokenId = adminWalletToTokenId[_issuer];
        adminTokens[tokenId].valid = false;

        emit IssuerRemoved(_issuer, tokenId);
    }

    /**
     * @dev Verify an Admin NFT by Token ID
     */
    function verifyAdminToken(uint256 _tokenId) external view returns (AdminToken memory adminToken, bool isValid) {
        require(_tokenId < tokenCount, "Token does not exist");
        AdminToken memory token = adminTokens[_tokenId];
        require(bytes(token.adminName).length > 0, "Not an admin token");
        return (token, token.valid);
    }
    
    /**
     * @dev Verify an Admin NFT by Wallet Address
     */
    function verifyAdminByWallet(address _issuer) external view returns (AdminToken memory adminToken, bool isValid) {
        require(authorizedIssuers[_issuer], "Address is not an active admin");
        uint256 tokenId = adminWalletToTokenId[_issuer];
        AdminToken memory token = adminTokens[tokenId];
        return (token, token.valid);
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

        uint256 certificateId = tokenCount++;

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
     * @dev Issue multiple certificates in a single transaction
     * @param _studentAddresses Array of student addresses
     * @param _studentNames Array of student names
     * @param _courses Array of course names
     * @param _issuers Array of issuer names
     * @param _ipfsHashes Array of IPFS hashes
     */
    function batchIssueCertificates(
        address[] memory _studentAddresses,
        string[] memory _studentNames,
        string[] memory _courses,
        string[] memory _issuers,
        string[] memory _ipfsHashes
    ) external returns (uint256[] memory) {
        require(authorizedIssuers[msg.sender], "Issuer not authorized");
        
        uint256 length = _studentAddresses.length;
        require(length > 0, "Empty arrays");
        require(length == _studentNames.length, "Mismatched lengths");
        require(length == _courses.length, "Mismatched lengths");
        require(length == _issuers.length, "Mismatched lengths");
        require(length == _ipfsHashes.length, "Mismatched lengths");

        uint256[] memory certificateIds = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            require(_studentAddresses[i] != address(0), "Invalid student address");
            require(bytes(_studentNames[i]).length > 0, "Student name required");
            require(bytes(_courses[i]).length > 0, "Course name required");
            require(bytes(_issuers[i]).length > 0, "Issuer name required");
            require(bytes(_ipfsHashes[i]).length > 0, "IPFS hash required");

            uint256 certificateId = tokenCount++;
            certificateIds[i] = certificateId;

            certificates[certificateId] = Certificate({
                studentName: _studentNames[i],
                course: _courses[i],
                issuer: _issuers[i],
                ipfsHash: _ipfsHashes[i],
                issueDate: block.timestamp,
                valid: true,
                issuerAddress: msg.sender
            });

            studentCertificates[_studentAddresses[i]].push(certificateId);

            _safeMint(_studentAddresses[i], certificateId);

            emit CertificateIssued(
                certificateId,
                _studentAddresses[i],
                _studentNames[i],
                _courses[i],
                _issuers[i],
                _ipfsHashes[i],
                block.timestamp
            );
        }

        return certificateIds;
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
        require(_certificateId < tokenCount, "Certificate does not exist");
        Certificate memory cert = certificates[_certificateId];
        require(bytes(cert.studentName).length > 0, "Not a certificate token");
        return (cert, cert.valid);
    }

    /**
     * @dev Revoke a certificate (mark as invalid)
     * @param _certificateId ID of the certificate to revoke
     */
    function revokeCertificate(uint256 _certificateId) external onlyOwnerOrIssuer(_certificateId) {
        require(_certificateId < tokenCount, "Certificate does not exist");
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
     * @dev Get total number of tokens issued (admins + certificates)
     */
    function getTotalTokenCount() external view returns (uint256) {
        return tokenCount;
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
        require(_certificateId < tokenCount, "Certificate does not exist");
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
