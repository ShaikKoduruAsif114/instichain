/**
 * src/pages/IssuerDashboard.tsx
 * 
 * Issuer Dashboard
 * Allows universities/institutions to issue blockchain certificates
 * 
 * Features:
 * - Upload certificate PDF
 * - Enter student details
 * - Issue certificate on blockchain
 * - Generate QR code
 * - View issued certificates
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Send,
  CheckCircle,
  AlertCircle,
  Loader,
  QrCode,
  Link2,
  Copy,
} from "lucide-react";
import {
  connectWallet,
  getCurrentWalletAddress,
  issueCertificate as issueCertificateOnChain,
  batchIssueCertificates,
  generateVerificationHash
} from "@/lib/blockchain";
import { uploadToIPFS, getIPFSUrl } from "@/lib/ipfs";
import { generateSampleCertificatePDF } from "@/lib/pdfGenerator";
import { generateCertificateQRCode, downloadQRCode } from "@/lib/qrcode";
import { doc, setDoc, collection, getDocs, onSnapshot, updateDoc, query, where } from "firebase/firestore";
import { db } from "@/firebaseConfig";

interface IssuanceRequest {
  studentAddress: string;
  studentName: string;
  courseName: string;
  issuerName: string;
  pdfFile?: File;
  ipfsHash?: string;
  certificateId?: number;
  qrCode?: string;
}

const IssuerDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Form state
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [formData, setFormData] = useState<IssuanceRequest>({
    studentAddress: "",
    studentName: "",
    courseName: "",
    issuerName: "",
  });

  // File input
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  // Loading and status
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"upload" | "fill" | "confirm" | "success">("upload");
  const [issuedCertificates, setIssuedCertificates] = useState<any[]>([]);
  const [pendingCertificates, setPendingCertificates] = useState<any[]>([]);
  const [issuingPendingId, setIssuingPendingId] = useState<string | null>(null);

  // Modal state
  const [showPreview, setShowPreview] = useState(false);

  // =================== INITIALIZATION ===================

  const initializeWallet = async () => {
    try {
      const address = await getCurrentWalletAddress();
      if (address) {
        setWalletAddress(address);
        loadIssuedCertificates(address);
      } else {
        const { address } = await connectWallet();
        setWalletAddress(address);
        loadIssuedCertificates(address);
      }
      // Subscribe to all pending certs from the proposal flow
      const q = query(collection(db, "pendingCertificates"), where("status", "==", "pending"));
      onSnapshot(q, (snap) => {
        setPendingCertificates(snap.docs.map(d => ({ _id: d.id, ...d.data() })));
      });
    } catch (error: any) {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // =================== LOAD ISSUED CERTIFICATES ===================

  const loadIssuedCertificates = async (issuerAddress: string) => {
    try {
      const certificatesRef = collection(db, "issued_certificates");
      const q = query(
        certificatesRef,
        where("issuerAddress", "==", issuerAddress)
      );
      const snapshot = await getDocs(q);

      const certs = snapshot.docs.map((doc) => doc.data());
      setIssuedCertificates(certs);
    } catch (error) {
      console.error("Failed to load certificates:", error);
    }
  };

  // =================== ISSUE PENDING CERTIFICATE (from proposal queue) ===================

  const issuePendingCertificate = async (pending: any) => {
    if (!pending.walletAddress) {
      toast({ title: "Missing wallet", description: "Student has not linked a wallet yet.", variant: "destructive" });
      return;
    }
    setIssuingPendingId(pending._id);
    try {
      toast({ description: "⛓️ Minting certificate on blockchain..." });

      // Generate a sample PDF for the student
      let ipfsHashToUse = `proposal-${pending.eventId}`;
      try {
        toast({ description: "📄 Generating certificate PDF..." });
        const pdf = await generateSampleCertificatePDF({
          studentName: pending.studentName,
          courseName: pending.courseName,
          issuerName: pending.issuerName || "InstitiChain",
          eventName: pending.eventName,
          date: new Date().toISOString(),
        });
        toast({ description: "📤 Uploading certificate PDF to IPFS..." });
        ipfsHashToUse = await uploadToIPFS(pdf);
      } catch (pdfErr) {
        console.warn("PDF generation failed, using placeholder:", pdfErr);
      }

      const certificateId = await issueCertificateOnChain(
        pending.walletAddress,
        pending.studentName,
        pending.courseName,
        pending.issuerName || "InstitiChain",
        ipfsHashToUse
      );
      // Mark pending cert as issued
      await updateDoc(doc(db, "pendingCertificates", pending._id), {
        status: "issued",
        certificateId,
        issuedAt: new Date().toISOString(),
      });
      // Update the matching certificates record
      const certsQ = await getDocs(query(
        collection(db, "certificates"),
        where("studentId", "==", pending.studentId),
        where("eventId", "==", pending.eventId),
        where("status", "==", "pending")
      ));
      for (const d of certsQ.docs) {
        await updateDoc(d.ref, { status: "issued", certificateId });
      }
      toast({ title: `🎓 Certificate #${certificateId} issued!`, description: `Minted to ${pending.walletAddress.slice(0, 10)}…` });
    } catch (err: any) {
      toast({ title: "Failed to issue", description: err.message, variant: "destructive" });
    } finally {
      setIssuingPendingId(null);
    }
  };

  const handleIssueAllPending = async () => {
    // Filter only those with wallet addresses
    const validPending = pendingCertificates.filter(p => !!p.walletAddress);

    if (validPending.length === 0) {
      toast({ title: "No valid pending", description: "No students have linked their wallets yet.", variant: "destructive" });
      return;
    }

    setIssuingPendingId("all");
    try {
      toast({ description: `⛓️ Batch minting ${validPending.length} certificates on blockchain...` });

      // Generate PDFs for each pending cert
      const hashes: string[] = [];
      for (const p of validPending) {
        try {
          const pdf = await generateSampleCertificatePDF({
            studentName: p.studentName,
            courseName: p.courseName,
            issuerName: p.issuerName || "InstitiChain",
            eventName: p.eventName,
            date: new Date().toISOString(),
          });
          const h = await uploadToIPFS(pdf);
          hashes.push(h);
        } catch {
          hashes.push(`proposal-${p.eventId}`);
        }
      }

      // Prepare arrays
      const addresses = validPending.map(p => p.walletAddress);
      const names = validPending.map(p => p.studentName);
      const courses = validPending.map(p => p.courseName);
      const issuers = validPending.map(p => p.issuerName || "InstitiChain");

      const certificateIds = await batchIssueCertificates(addresses, names, courses, issuers, hashes);

      // Now update them all in Firebase
      for (let i = 0; i < validPending.length; i++) {
        const p = validPending[i];
        const certId = certificateIds[i]; // Assuming the returned array aligns 1:1, or we just trust they were emitted

        // Mark pending as issued
        await updateDoc(doc(db, "pendingCertificates", p._id), {
          status: "issued",
          certificateId: certId || 0, // Fallback if IDs empty
          issuedAt: new Date().toISOString(),
        });

        const certsQ = await getDocs(query(
          collection(db, "certificates"),
          where("studentId", "==", p.studentId),
          where("eventId", "==", p.eventId),
          where("status", "==", "pending")
        ));
        for (const d of certsQ.docs) {
          await updateDoc(d.ref, { status: "issued", certificateId: certId || 0 });
        }
      }

      toast({ title: `🎓 Batch successful! Issued ${validPending.length} certificates.` });
    } catch (err: any) {
      toast({ title: "Batch Issue Failed", description: err.message, variant: "destructive" });
    } finally {
      setIssuingPendingId(null);
    }
  };

  // =================== FILE UPLOAD ===================

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== "application/pdf") {
        toast({
          title: "Invalid File",
          description: "Please upload a PDF file",
          variant: "destructive",
        });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File Too Large",
          description: "PDF must be less than 10MB",
          variant: "destructive",
        });
        return;
      }
      setPdfFile(file);
      setFormData({ ...formData, pdfFile: file });
      setStep("fill");
    }
  };

  // =================== FORM SUBMISSION ===================

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  // =================== ISSUE CERTIFICATE ===================

  const handleIssueCertificate = async () => {
    setLoading(true);
    try {
      // 1. Use provided PDF or auto-generate one
      let fileToUpload: File | null = pdfFile;
      if (!fileToUpload) {
        toast({ description: "📄 Generating certificate PDF..." });
        fileToUpload = await generateSampleCertificatePDF({
          studentName: formData.studentName,
          courseName: formData.courseName,
          issuerName: formData.issuerName,
          date: new Date().toISOString(),
        });
      }

      toast({ description: "📤 Uploading certificate to IPFS..." });
      const ipfsHash = await uploadToIPFS(fileToUpload);
      setFormData((prev) => ({ ...prev, ipfsHash }));

      // 2. Issue on blockchain
      toast({ description: "⛓️ Issuing certificate on blockchain..." });
      const certificateId = await issueCertificateOnChain(
        formData.studentAddress,
        formData.studentName,
        formData.courseName,
        formData.issuerName,
        ipfsHash
      );

      setFormData((prev) => ({ ...prev, certificateId }));

      // 3. Generate QR code
      toast({ description: "📱 Generating QR code..." });
      const qrCode = await generateCertificateQRCode(certificateId);
      setFormData((prev) => ({ ...prev, qrCode }));

      // 4. Save to Firebase
      await setDoc(doc(db, "issued_certificates", String(certificateId)), {
        certificateId,
        studentName: formData.studentName,
        courseName: formData.courseName,
        issuerName: formData.issuerName,
        issuerAddress: walletAddress,
        studentAddress: formData.studentAddress,
        ipfsHash,
        qrCode,
        issuedAt: new Date().toISOString(),
      });

      setStep("success");
      loadIssuedCertificates(walletAddress!);

      toast({
        title: "✅ Certificate Issued Successfully",
        description: `Certificate ID: ${certificateId}`,
      });
    } catch (error: any) {
      toast({
        title: "❌ Failed to Issue Certificate",
        description: error.message,
        variant: "destructive",
      });
      setStep("fill");
    } finally {
      setLoading(false);
    }
  };

  // =================== RENDER ===================

  if (!walletAddress) {
    return (
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Issuer Dashboard</CardTitle>
              <CardDescription>
                Connect your wallet to start issuing certificates
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={initializeWallet} size="lg" className="w-full">
                Connect Wallet
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Issuer Dashboard</h1>
          <p className="text-muted-foreground">
            Issue blockchain-verified certificates
          </p>
          <Badge variant="outline" className="mt-2">
            Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Form */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Issue New Certificate</CardTitle>
                <CardDescription>
                  {step === "upload" && "Step 1: Upload certificate PDF"}
                  {step === "fill" && "Step 2: Fill student details"}
                  {step === "confirm" && "Step 3: Review and confirm"}
                  {step === "success" && "Certificate issued!"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Upload Step */}
                {step === "upload" && (
                  <div className="space-y-4">
                    <div className="border-2 border-dashed rounded-lg p-8 text-center">
                      <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                      <label className="cursor-pointer">
                        <span className="text-sm font-medium text-primary hover:underline">
                          Click to upload
                        </span>
                        <input
                          type="file"
                          accept=".pdf"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </label>
                      <p className="text-xs text-muted-foreground mt-2">
                        PDF up to 10MB
                      </p>
                    </div>
                    {pdfFile && (
                      <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{pdfFile.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(pdfFile.size / 1024).toFixed(2)} KB
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Fill Details Step */}
                {(step === "fill" || step === "confirm" || step === "success") && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Student Wallet Address</label>
                      <Input
                        name="studentAddress"
                        placeholder="0x..."
                        value={formData.studentAddress}
                        onChange={handleInputChange}
                        disabled={step === "success" || loading}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Student Name</label>
                      <Input
                        name="studentName"
                        placeholder="John Doe"
                        value={formData.studentName}
                        onChange={handleInputChange}
                        disabled={step === "success" || loading}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Course Name</label>
                      <Input
                        name="courseName"
                        placeholder="Advanced Blockchain Development"
                        value={formData.courseName}
                        onChange={handleInputChange}
                        disabled={step === "success" || loading}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Issuer Name</label>
                      <Input
                        name="issuerName"
                        placeholder="Your University"
                        value={formData.issuerName}
                        onChange={handleInputChange}
                        disabled={step === "success" || loading}
                      />
                    </div>
                  </div>
                )}

                {/* Success Step */}
                {step === "success" && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                      <CheckCircle className="w-6 h-6 text-green-600" />
                      <div>
                        <p className="font-medium text-green-900">
                          Certificate Issued Successfully!
                        </p>
                        <p className="text-sm text-green-700">
                          ID: {formData.certificateId}
                        </p>
                      </div>
                    </div>

                    {formData.qrCode && (
                      <div className="flex flex-col items-center gap-3 p-4 bg-muted rounded-lg">
                        <img src={formData.qrCode} alt="QR Code" className="w-40 h-40" />
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              downloadQRCode(
                                formData.qrCode!,
                                `cert-${formData.certificateId}.png`
                              )
                            }
                          >
                            Download QR
                          </Button>
                        </div>
                      </div>
                    )}

                    {formData.certificateId !== undefined && (
                      <div className="p-3 bg-muted rounded-lg text-sm">
                        <div className="flex items-center justify-between mb-2">
                          <p className="font-medium">Verification Hash</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 -my-1"
                            onClick={() => {
                              const hash = generateVerificationHash("cert", formData.certificateId!);
                              navigator.clipboard.writeText(hash);
                              toast({ description: "Verification hash copied to clipboard!" });
                            }}
                          >
                            <Copy className="w-4 h-4 mr-2" />
                            Copy
                          </Button>
                        </div>
                        <p className="font-mono text-xs text-primary break-all bg-background p-2 rounded border">
                          {generateVerificationHash("cert", formData.certificateId)}
                        </p>
                      </div>
                    )}

                    {formData.ipfsHash && (
                      <div className="p-3 bg-muted rounded-lg text-sm">
                        <p className="font-medium mb-2">Certificate Link</p>
                        <a
                          href={`https://w3s.link/ipfs/${formData.ipfsHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline break-all"
                        >
                          {formData.ipfsHash}
                        </a>
                      </div>
                    )}

                    <Button onClick={() => window.location.reload()} className="w-full">
                      Issue Another Certificate
                    </Button>
                  </div>
                )}

                {/* Buttons */}
                {step !== "success" && (
                  <div className="flex gap-3">
                    {step === "fill" && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setStep("upload");
                            setPdfFile(null);
                          }}
                        >
                          Back
                        </Button>
                        <Button
                          onClick={() => setStep("confirm")}
                          disabled={
                            !formData.studentAddress ||
                            !formData.studentName ||
                            !formData.courseName ||
                            !formData.issuerName
                          }
                          className="flex-1"
                        >
                          Review & Confirm
                        </Button>
                      </>
                    )}

                    {step === "confirm" && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => setStep("fill")}
                        >
                          Back
                        </Button>
                        <Button
                          onClick={handleIssueCertificate}
                          disabled={loading}
                          className="flex-1"
                        >
                          {loading ? (
                            <>
                              <Loader className="w-4 h-4 mr-2 animate-spin" />
                              Issuing...
                            </>
                          ) : (
                            <>
                              <Send className="w-4 h-4 mr-2" />
                              Issue Certificate
                            </>
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: Stats */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Certificates Issued</p>
                  <p className="text-3xl font-bold">{issuedCertificates.length}</p>
                </div>
              </CardContent>
            </Card>


            {/* Recent Activity */}
            {issuedCertificates.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Recent Issues</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {issuedCertificates.slice(-5).reverse().map((cert) => (
                      <div
                        key={cert.certificateId}
                        className="text-sm p-3 bg-muted rounded-lg"
                      >
                        <p className="font-medium">{cert.studentName}</p>
                        <p className="text-xs text-muted-foreground">{cert.courseName}</p>
                        <p className="text-xs text-primary">#{cert.certificateId}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* ========= PENDING CERTIFICATES FROM CLUB PROPOSALS ========= */}
        {pendingCertificates.length > 0 && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  🕐 Pending Certificates ({pendingCertificates.length})
                </div>
                {pendingCertificates.filter(p => !!p.walletAddress).length > 1 && (
                  <Button
                    variant="outline"
                    onClick={handleIssueAllPending}
                    disabled={issuingPendingId !== null}
                  >
                    {issuingPendingId === "all" ? "Issuing All..." : "Issue All Valid on Blockchain"}
                  </Button>
                )}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                These were approved by club admin votes and are awaiting on-chain issuance by you (authorized issuer).
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {pendingCertificates.map((p) => (
                  <div key={p._id} className="flex items-center justify-between p-3 bg-white dark:bg-muted rounded-lg border">
                    <div>
                      <p className="font-medium text-sm">{p.studentName}</p>
                      <p className="text-xs text-muted-foreground">Course: {p.courseName}</p>
                      <p className="text-xs text-muted-foreground">
                        Wallet: {p.walletAddress
                          ? `${p.walletAddress.slice(0, 10)}…${p.walletAddress.slice(-6)}`
                          : <span className="text-red-500">No wallet — student must link MetaMask first</span>
                        }
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={issuingPendingId === p._id || !p.walletAddress}
                      onClick={() => issuePendingCertificate(p)}
                    >
                      {issuingPendingId === p._id ? "Issuing…" : "Issue on Blockchain"}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      </div>


      {/* Confirmation Dialog */}
      <AlertDialog open={step === "confirm"} onOpenChange={(open) => {
        if (!open) setStep("fill");
      }}>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm Certificate Issuance</AlertDialogTitle>
          <AlertDialogDescription>
            <div className="space-y-3 text-left">
              <div>
                <p className="text-sm text-muted-foreground">Student</p>
                <p className="font-medium">{formData.studentName}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Course</p>
                <p className="font-medium">{formData.courseName}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Issuer</p>
                <p className="font-medium">{formData.issuerName}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">PDF</p>
                <p className="font-medium text-xs">{pdfFile?.name}</p>
              </div>
            </div>
          </AlertDialogDescription>
          <div className="flex gap-3">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleIssueCertificate} disabled={loading}>
              {loading ? "Issuing..." : "Confirm & Issue"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default IssuerDashboard;
