/**
 * src/pages/VerifyCertificate.tsx
 * 
 * Certificate Verification Page
 * Allows recruiters and third parties to verify certificates
 * 
 * Features:
 * - Search by certificate ID
 * - Search by wallet address
 * - Display certificate authenticity
 * - Show issuer details
 * - Access verifiable PDF link
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Award,
  FileText,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader,
  AlertCircle,
  Search,
  Clock,
  Building2,
  User,
} from "lucide-react";
import {
  verifyCertificate,
  getCertificateDetails,
  getCertificatesByOwner,
  Certificate,
} from "@/lib/blockchain";
import { getIPFSUrl } from "@/lib/ipfs";
import { parseCertificateIdFromUrl } from "@/lib/qrcode";

interface VerificationResult {
  certificateId: number;
  certificate: Certificate;
  isValid: boolean;
  verifiedAt: string;
}

const VerifyCertificate = () => {
  const { certificateId: urlCertId } = useParams<{ certificateId?: string }>();
  const { toast } = useToast();

  // Search state
  const [searchType, setSearchType] = useState<"id" | "wallet">("id");
  const [searchInput, setSearchInput] = useState("");
  const [walletCertificates, setWalletCertificates] = useState<number[]>([]);

  // Verification state
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // =================== INITIALIZATION ===================

  useEffect(() => {
    if (urlCertId) {
      handleVerifyCertificateId(urlCertId);
    }
  }, [urlCertId]);

  // =================== VERIFICATION FUNCTIONS ===================

  const handleVerifyCertificateId = async (certId: string) => {
    try {
      setLoading(true);
      setError(null);

      const id = parseInt(certId, 10);
      if (isNaN(id)) {
        throw new Error("Invalid certificate ID");
      }

      const { certificate, isValid } = await verifyCertificate(id);

      setVerificationResult({
        certificateId: id,
        certificate,
        isValid,
        verifiedAt: new Date().toISOString(),
      });

      toast({
        description: isValid ? "✅ Certificate verified successfully" : "⚠️ Certificate is revoked",
      });
    } catch (error: any) {
      setError(error.message);
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearchByCertificateId = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) {
      setError("Please enter a certificate ID");
      return;
    }
    await handleVerifyCertificateId(searchInput.trim());
  };

  const handleSearchByWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) {
      setError("Please enter a wallet address");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setVerificationResult(null);

      const certIds = await getCertificatesByOwner(searchInput.trim());

      if (certIds.length === 0) {
        setError("No certificates found for this wallet address");
        setWalletCertificates([]);
        toast({
          description: "No certificates found for this wallet",
        });
      } else {
        setWalletCertificates(certIds);
        toast({
          description: `Found ${certIds.length} certificate(s) for this wallet`,
        });
      }
    } catch (error: any) {
      setError(error.message);
      toast({
        title: "Search Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // =================== RENDER FUNCTIONS ===================

  const renderAuthenticityBadge = (isValid: boolean) => {
    if (isValid) {
      return (
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle className="w-6 h-6 text-green-600" />
          <div>
            <p className="font-semibold text-green-900">✅ Certificate Verified</p>
            <p className="text-sm text-green-700">This certificate is authentic and valid</p>
          </div>
        </div>
      );
    } else {
      return (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
          <XCircle className="w-6 h-6 text-red-600" />
          <div>
            <p className="font-semibold text-red-900">❌ Certificate Revoked</p>
            <p className="text-sm text-red-700">This certificate has been revoked by the issuer</p>
          </div>
        </div>
      );
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // =================== MAIN RENDER ===================

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2 text-center">
          <h1 className="text-4xl font-bold">Certificate Verification</h1>
          <p className="text-muted-foreground">
            Verify blockchain credentials instantly
          </p>
        </div>

        {/* Search Section */}
        <Card>
          <CardHeader>
            <CardTitle>Search Certificate</CardTitle>
            <CardDescription>
              {searchType === "id"
                ? "Enter the certificate ID to verify"
                : "Enter a wallet address to view all certificates"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Toggle Buttons */}
            <div className="flex gap-2">
              <Button
                variant={searchType === "id" ? "default" : "outline"}
                onClick={() => {
                  setSearchType("id");
                  setSearchInput("");
                  setVerificationResult(null);
                  setWalletCertificates([]);
                }}
              >
                Search by ID
              </Button>
              <Button
                variant={searchType === "wallet" ? "default" : "outline"}
                onClick={() => {
                  setSearchType("wallet");
                  setSearchInput("");
                  setVerificationResult(null);
                  setWalletCertificates([]);
                }}
              >
                Search by Wallet
              </Button>
            </div>

            {/* Search Form */}
            <form
              onSubmit={
                searchType === "id"
                  ? handleSearchByCertificateId
                  : handleSearchByWallet
              }
              className="flex gap-2"
            >
              <Input
                placeholder={
                  searchType === "id"
                    ? "Enter certificate ID (e.g., 123)"
                    : "Enter wallet address (0x...)"
                }
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setError(null);
                }}
              />
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Search
                  </>
                )}
              </Button>
            </form>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Verification Result */}
        {verificationResult && (
          <div className="space-y-6">
            {/* Authenticity Badge */}
            {renderAuthenticityBadge(verificationResult.isValid)}

            {/* Certificate Details */}
            <Card>
              <CardHeader>
                <CardTitle>Certificate Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Student Info */}
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <User className="w-4 h-4" />
                        Student Name
                      </p>
                      <p className="text-lg font-semibold">
                        {verificationResult.certificate.studentName}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Course/Credential</p>
                      <p className="text-lg font-semibold">
                        {verificationResult.certificate.course}
                      </p>
                    </div>
                  </div>

                  {/* Issuer Info */}
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        Issuing Institution
                      </p>
                      <p className="text-lg font-semibold">
                        {verificationResult.certificate.issuer}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Issued Date
                      </p>
                      <p className="text-lg font-semibold">
                        {formatDate(verificationResult.certificate.issueDate)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Blockchain Details */}
                <div className="border-t pt-4 space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Certificate ID</p>
                    <p className="font-mono text-sm text-primary">
                      #{verificationResult.certificateId}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">Issuer Address</p>
                    <p className="font-mono text-sm break-all">
                      {verificationResult.certificate.issuerAddress}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">Verified At</p>
                    <p className="text-sm">
                      {new Date(verificationResult.verifiedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* IPFS Link */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Certificate Document</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <a
                  href={getIPFSUrl(verificationResult.certificate.ipfsHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-4 border rounded-lg hover:bg-muted transition-colors"
                >
                  <FileText className="w-6 h-6 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Certificate PDF</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {verificationResult.certificate.ipfsHash}
                    </p>
                  </div>
                  <ExternalLink className="w-5 h-5 text-primary flex-shrink-0" />
                </a>
                <p className="text-xs text-muted-foreground">
                  Click to view the certificate document stored on IPFS
                </p>
              </CardContent>
            </Card>

            {/* Verification Badge */}
            <Card className="bg-muted/50">
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <p className="text-sm font-medium">
                      ✅ Stored on Local Hardhat Network
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <p className="text-sm font-medium">
                      ✅ Tamper-proof (Soulbound NFT)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                    <p className="text-sm font-medium">
                      ✅ Verified from Smart Contract
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Wallet Search Results */}
        {walletCertificates.length > 0 && !verificationResult && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Found {walletCertificates.length} certificate(s) for this wallet
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {walletCertificates.map((certId) => (
                <Button
                  key={certId}
                  variant="outline"
                  onClick={() => {
                    setSearchInput("");
                    handleVerifyCertificateId(String(certId));
                  }}
                  className="text-left justify-start"
                >
                  <Award className="w-4 h-4 mr-2" />
                  Certificate #{certId}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Info Section */}
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-600" />
              How Verification Works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-blue-900">
            <p>
              ✓ All certificates are stored on the local Hardhat blockchain as Soulbound NFTs
            </p>
            <p>
              ✓ Certificate data (student name, course, issuer, PDF) is immutable and tamper-proof
            </p>
            <p>
              ✓ Only authorized issuers can create certificates
            </p>
            <p>
              ✓ Revocation is instant - revoked certificates show as invalid
            </p>
            <p>
              ✓ You can verify any certificate without owning it
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default VerifyCertificate;
