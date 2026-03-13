/**
 * src/pages/CertificatePortal.tsx
 * 
 * Student Certificate Portal
 * Allows students to view their blockchain-issued certificates
 * 
 * Features:
 * - View all certificates earned
 * - Display certificate details
 * - Access IPFS-hosted PDFs
 * - Share QR code
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText,
  ExternalLink,
  QrCode,
  Download,
  Loader,
  AlertCircle,
  CheckCircle,
  Clock,
} from "lucide-react";
import {
  connectWallet,
  getCurrentWalletAddress,
  getStudentCertificates,
  CertificateWithId,
} from "@/lib/blockchain";
import { getIPFSUrl, isValidIPFSHash } from "@/lib/ipfs";
import { generateCertificateQRCode } from "@/lib/qrcode";

const CertificatePortal = () => {
  const { toast } = useToast();

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [certificates, setCertificates] = useState<CertificateWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCert, setSelectedCert] = useState<CertificateWithId | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [certQrCodeUrl, setCertQrCodeUrl] = useState<string | null>(null);

  // =================== INITIALIZATION ===================

  useEffect(() => {
    const init = async () => {
      try {
        const address = await getCurrentWalletAddress();
        if (!address) {
          await connectWallet();
          const newAddress = await getCurrentWalletAddress();
          if (newAddress) {
            setWalletAddress(newAddress);
            loadCertificates(newAddress);
          }
        } else {
          setWalletAddress(address);
          loadCertificates(address);
        }
      } catch (error: any) {
        toast({
          title: "Connection Failed",
          description: error.message,
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  // =================== LOAD CERTIFICATES ===================

  const loadCertificates = async (address: string) => {
    try {
      setLoading(true);
      const certs = await getStudentCertificates(address);
      setCertificates(certs);

      if (certs.length === 0) {
        toast({
          description: "No certificates found for your wallet",
        });
      } else {
        toast({
          description: `Loaded ${certs.length} certificate(s)`,
        });
      }
    } catch (error: any) {
      console.error("Error loading certificates:", error);
      toast({
        title: "Failed to Load Certificates",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // =================== FORMAT DATE ===================

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // =================== RENDER ===================

  if (loading) {
    return (
      <div className="min-h-screen bg-background py-12 px-4 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader className="w-12 h-12 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading your certificates...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Your Certificates</h1>
          <p className="text-muted-foreground">
            View and manage your blockchain-verified certificates
          </p>
          {walletAddress && (
            <Badge variant="outline" className="mt-2">
              Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </Badge>
          )}
        </div>

        {/* Empty State */}
        {certificates.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent className="space-y-4">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground" />
              <div>
                <p className="font-medium">No Certificates Yet</p>
                <p className="text-sm text-muted-foreground">
                  When you receive certificates from issuers, they will appear here
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Certificates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{certificates.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Valid Certificates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {certificates.filter((c) => c.valid).length}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Revoked
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {certificates.filter((c) => !c.valid).length}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Certificate Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {certificates.map((cert) => (
                <Card key={cert.certificateId} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-xl">{cert.course}</CardTitle>
                        <CardDescription>{cert.studentName}</CardDescription>
                      </div>
                      <Badge variant={cert.valid ? "default" : "destructive"}>
                        {cert.valid ? "Valid" : "Revoked"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Details */}
                    <div className="space-y-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Issuer</p>
                        <p className="font-medium">{cert.issuer}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Issued</p>
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          <p className="font-medium">{formatDate(cert.issueDate)}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Certificate ID</p>
                        <p className="font-mono text-xs text-primary">
                          #{cert.certificateId}
                        </p>
                      </div>
                    </div>

                    {/* Status Indicator */}
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-muted">
                      {cert.valid ? (
                        <>
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          <div className="flex-1">
                            <p className="text-sm font-medium">Certificate Verified</p>
                            <p className="text-xs text-muted-foreground">
                              Stored on blockchain
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-5 h-5 text-red-600" />
                          <div className="flex-1">
                            <p className="text-sm font-medium">Certificate Revoked</p>
                            <p className="text-xs text-muted-foreground">
                              By issuer
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          setSelectedCert(cert);
                          setShowDetails(true);
                          try {
                            const qr = await generateCertificateQRCode(cert.certificateId);
                            setCertQrCodeUrl(qr);
                          } catch (err) {
                            console.error("Failed to generate QR for cert", err);
                          }
                        }}
                        className="flex-1"
                      >
                        <FileText className="w-4 h-4 mr-2" />
                        View Details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedCert?.course}</DialogTitle>
            <DialogDescription>{selectedCert?.studentName}</DialogDescription>
          </DialogHeader>

          {selectedCert && (
            <div className="space-y-6">
              {/* Certificate Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Issuer</p>
                  <p className="font-medium">{selectedCert.issuer}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Issued Date</p>
                  <p className="font-medium">{formatDate(selectedCert.issueDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Certificate ID</p>
                  <p className="font-mono text-xs text-primary">
                    #{selectedCert.certificateId}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="font-medium">
                    {selectedCert.valid ? "✅ Valid" : "❌ Revoked"}
                  </p>
                </div>
              </div>

              {/* IPFS Link */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Certificate PDF</p>
                {isValidIPFSHash(selectedCert.ipfsHash) ? (
                  <a
                    href={getIPFSUrl(selectedCert.ipfsHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 border rounded-lg hover:bg-muted"
                  >
                    <FileText className="w-4 h-4" />
                    <span className="text-sm font-medium flex-1 break-all">
                      {selectedCert.ipfsHash}
                    </span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                ) : (
                  <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/50">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      No PDF available for this certificate
                    </span>
                  </div>
                )}
              </div>

              {/* QR Code */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Verification QR Code</p>
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-white rounded-lg border shadow-sm flex flex-col items-center">
                    {certQrCodeUrl ? (
                      <>
                        <img src={certQrCodeUrl} alt="Certificate QR" className="w-32 h-32" />
                        <p className="text-xs text-muted-foreground text-center mt-2">
                          Scan to verify certificate
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground py-10 w-32 text-center">Loading QR...</p>
                    )}
                  </div>
                  {certQrCodeUrl && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = certQrCodeUrl;
                        link.download = `certificate-${selectedCert.certificateId}-qr.png`;
                        link.click();
                      }}
                    >
                      <QrCode className="w-4 h-4 mr-2" />
                      Save QR
                    </Button>
                  )}
                </div>
              </div>

              {/* Share */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Share</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const url = `${window.location.origin}/verify/${selectedCert.certificateId}`;
                      navigator.clipboard.writeText(url);
                      toast({
                        description: "Verification link copied to clipboard",
                      });
                    }}
                  >
                    Copy Link
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const url = `${window.location.origin}/verify/${selectedCert.certificateId}`;
                      window.open(
                        `https://twitter.com/intent/tweet?text=I earned a blockchain credential! Verify it: ${url}`,
                        "_blank"
                      );
                    }}
                  >
                    Share on Twitter
                  </Button>
                </div>
              </div>

              {/* Download PDF Button */}
              {isValidIPFSHash(selectedCert.ipfsHash) ? (
                <Button
                  onClick={() => {
                    const ipfsUrl = getIPFSUrl(selectedCert.ipfsHash);
                    const a = document.createElement("a");
                    a.href = ipfsUrl;
                    a.download = `certificate-${selectedCert.certificateId}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }}
                  className="w-full"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Certificate PDF
                </Button>
              ) : (
                <Button variant="outline" className="w-full" disabled>
                  <Download className="w-4 h-4 mr-2" />
                  No PDF Available
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CertificatePortal;
