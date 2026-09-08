/**
 * src/pages/HeadIssuerDashboard.tsx
 * 
 * Head/Issuer Dashboard
 * For heads/issuers who can:
 * - Issue certificates on blockchain
 * - Award tokens/credits to students
 * - Manage certificates
 * - Generate QR codes
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebaseConfig";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Send,
  CheckCircle,
  AlertCircle,
  Loader,
  QrCode,
  Award,
  FileText,
  Users,
  Copy,
} from "lucide-react";
import {
  connectWallet,
  getCurrentWalletAddress,
  issueCertificate as issueCertificateOnChain,
  generateVerificationHash,
} from "@/lib/blockchain";
import { uploadToIPFS, getIPFSUrl, placeholderCIDFor } from "@/lib/ipfs";
import { generateSampleCertificatePDF } from "@/lib/pdfGenerator";
import { generateCertificateQRCode, downloadQRCode } from "@/lib/qrcode";
import { doc, setDoc, collection, getDocs, query, where, updateDoc } from "firebase/firestore";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface IssuanceRequest {
  studentName: string;
  studentEmail: string;
  studentWalletAddress: string;
  certificateTitle: string;
  description: string;
  pdfFile?: File;
}

interface IssuedCertificate {
  id: string;
  studentName: string;
  studentEmail: string;
  certificateTitle: string;
  issueDate: string;
  transactionHash?: string;
  qrCode?: string;
  ipfsHash?: string;
  status: "pending" | "issued" | "failed";
}

const HeadIssuerDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);

  // Certificate Issuance States
  const [formData, setFormData] = useState<IssuanceRequest>({
    studentName: "",
    studentEmail: "",
    studentWalletAddress: "",
    certificateTitle: "",
    description: "",
  });
  const [issuanceLoading, setIssuanceLoading] = useState(false);
  const [issuedCertificates, setIssuedCertificates] = useState<IssuedCertificate[]>([]);

  // Token Award States
  const [awardData, setAwardData] = useState({
    studentEmail: "",
    tokens: 0,
    reason: "",
  });
  const [awardLoading, setAwardLoading] = useState(false);

  // Auth check
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/signin");
        return;
      }

      const userDoc = await doc(db, "users", user.uid);
      const userSnap = await (
        await import("firebase/firestore").then((m) => m.getDoc)
      )(userDoc);

      if (!userSnap.exists()) {
        console.error("User profile not found");
        navigate("/signin");
        return;
      }

      const role = userSnap.data()?.role;
      if (role !== "head") {
        console.error("Unauthorized role:", role);
        navigate("/dashboard");
        return;
      }

      setCurrentUser({ uid: user.uid, ...userSnap.data() });

      // Load issued certificates
      const certsRef = collection(db, "certificates");
      const q = query(certsRef, where("issuerUid", "==", user.uid));
      const snapshot = await getDocs(q);
      const certs: IssuedCertificate[] = [];
      snapshot.forEach((doc) => {
        certs.push({ id: doc.id, ...doc.data() } as IssuedCertificate);
      });
      setIssuedCertificates(certs);

      setLoading(false);
    });

    return () => unsub();
  }, [navigate]);

  const handleConnectWallet = async () => {
    setIsConnecting(true);
    try {
      await connectWallet();
      const address = await getCurrentWalletAddress();
      setWalletAddress(address);

      // Save wallet to user profile
      if (currentUser) {
        await updateDoc(doc(db, "users", currentUser.uid), {
          walletAddress: address,
        });
        setCurrentUser({ ...currentUser, walletAddress: address });
      }

      toast({ title: "Wallet Connected", description: `Address: ${address}` });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleIssueCertificate = async () => {
    if (!walletAddress) {
      toast({ title: "Error", description: "Please connect wallet first", variant: "destructive" });
      return;
    }

    if (!formData.studentName || !formData.studentEmail || !formData.studentWalletAddress || !formData.certificateTitle) {
      toast({ title: "Error", description: "Please fill all required fields including student wallet address", variant: "destructive" });
      return;
    }

    setIssuanceLoading(true);
    try {
      // Attach a PDF when possible; if generation/upload fails (e.g. Pinata
      // not configured), fall back to an explicit no-document sentinel instead
      // of blocking issuance or writing an invalid CID (which reverts on-chain).
      let ipfsHash = placeholderCIDFor(`head:${formData.studentWalletAddress}:${formData.certificateTitle}`);
      try {
        if (formData.pdfFile) {
          toast({ description: "📤 Uploading PDF to IPFS..." });
          ipfsHash = await uploadToIPFS(formData.pdfFile);
        } else {
          toast({ description: "📄 Generating certificate PDF..." });
          const generatedPdf = await generateSampleCertificatePDF({
            studentName: formData.studentName,
            courseName: formData.certificateTitle,
            issuerName: currentUser.name,
            date: new Date().toISOString(),
          });
          toast({ description: "📤 Uploading certificate PDF to IPFS..." });
          ipfsHash = await uploadToIPFS(generatedPdf);
        }
      } catch (pdfErr: any) {
        console.warn("PDF pipeline failed, issuing without document:", pdfErr.message);
        toast({ description: "⚠️ Document upload unavailable — issuing without PDF" });
      }

      const certificateData = {
        studentName: formData.studentName,
        studentEmail: formData.studentEmail,
        certificateTitle: formData.certificateTitle,
        description: formData.description,
        issuerAddress: walletAddress,
        issuerUid: currentUser.uid,
        issuerName: currentUser.name,
        ipfsHash,
        issueDate: new Date().toISOString(),
        status: "pending" as const,
      };

      // Issue on blockchain first — returns the certificate ID (number)
      const certificateId = await issueCertificateOnChain(
        formData.studentWalletAddress,   // student's ETH address
        formData.studentName,             // student name
        formData.certificateTitle,        // course / credential name
        currentUser.name,                 // issuing institution (head's name)
        ipfsHash                          // IPFS hash of PDF (empty string if no PDF)
      );
      const txHash = String(certificateId); // store as string for consistency

      // Generate QR code using the real certificate ID
      const qrCode = await generateCertificateQRCode(certificateId);

      // Store in Firestore
      const certRef = doc(collection(db, "certificates"));
      await setDoc(certRef, {
        ...certificateData,
        qrCode,
        transactionHash: txHash,
        status: "issued",
      });

      // Update local list
      setIssuedCertificates([
        ...issuedCertificates,
        {
          id: certRef.id,
          ...certificateData,
          qrCode,
          transactionHash: txHash,
          status: "issued" as const,
        },
      ]);

      // Clear form
      setFormData({
        studentName: "",
        studentEmail: "",
        studentWalletAddress: "",
        certificateTitle: "",
        description: "",
      });

      toast({
        title: "Success",
        description: "Certificate issued successfully",
      });
    } catch (error: any) {
      console.error("Certificate issuance error:", error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIssuanceLoading(false);
    }
  };

  const handleAwardTokens = async () => {
    if (!awardData.studentEmail || awardData.tokens <= 0) {
      toast({
        title: "Error",
        description: "Please enter valid email and token amount",
        variant: "destructive",
      });
      return;
    }

    setAwardLoading(true);
    try {
      // Find student by email
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", awardData.studentEmail));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        toast({
          title: "Error",
          description: "Student not found",
          variant: "destructive",
        });
        return;
      }

      const studentDoc = snapshot.docs[0];
      const currentTokens = studentDoc.data()?.tokens || 0;

      // Update tokens
      await updateDoc(doc(db, "users", studentDoc.id), {
        tokens: currentTokens + awardData.tokens,
      });

      // Clear form
      setAwardData({
        studentEmail: "",
        tokens: 0,
        reason: "",
      });

      toast({
        title: "Success",
        description: `${awardData.tokens} tokens awarded to ${awardData.studentEmail}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setAwardLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">🏆 Head / Issuer Dashboard</h1>
        <p className="text-gray-600">Issue certificates, award tokens, and manage credentials</p>
      </div>

      {/* Wallet Connection Card */}
      <Card className="mb-6 bg-gradient-to-r from-blue-50 to-blue-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" /> Blockchain Connection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Wallet Address</p>
              <p className="font-mono text-lg">
                {walletAddress ? `${walletAddress.slice(0, 10)}...${walletAddress.slice(-8)}` : "Not Connected"}
              </p>
            </div>
            <Button onClick={handleConnectWallet} disabled={isConnecting} size="lg">
              {isConnecting ? "Connecting..." : walletAddress ? "✓ Connected" : "Connect Wallet"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Tabs */}
      <Tabs defaultValue="issue" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="issue">
            <FileText className="w-4 h-4 mr-2" /> Issue Certificates
          </TabsTrigger>
          <TabsTrigger value="tokens">
            <Award className="w-4 h-4 mr-2" /> Award Tokens
          </TabsTrigger>
        </TabsList>

        {/* Issue Certificates Tab */}
        <TabsContent value="issue" className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Create Certificate</CardTitle>
              <CardDescription>Issue a new certificate to a student</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Student Name *</label>
                <Input
                  placeholder="John Doe"
                  value={formData.studentName}
                  onChange={(e) =>
                    setFormData({ ...formData, studentName: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="text-sm font-medium">Student Email *</label>
                <Input
                  type="email"
                  placeholder="student@example.com"
                  value={formData.studentEmail}
                  onChange={(e) =>
                    setFormData({ ...formData, studentEmail: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="text-sm font-medium">Student Wallet Address *</label>
                <Input
                  placeholder="0x..."
                  value={formData.studentWalletAddress}
                  onChange={(e) =>
                    setFormData({ ...formData, studentWalletAddress: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="text-sm font-medium">Certificate Title *</label>
                <Input
                  placeholder="Certificate of Achievement"
                  value={formData.certificateTitle}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      certificateTitle: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  placeholder="Details about the certificate..."
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <div>
                <label className="text-sm font-medium">Certificate PDF (Optional)</label>
                <Input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      pdfFile: e.target.files?.[0],
                    })
                  }
                />
              </div>

              <Button
                onClick={handleIssueCertificate}
                disabled={issuanceLoading || !walletAddress}
                className="w-full"
              >
                {issuanceLoading ? (
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
            </CardContent>
          </Card>

          {/* Issued Certificates */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Issued Certificates ({issuedCertificates.length})</CardTitle>
                <CardDescription>Recent certificates issued by you</CardDescription>
              </CardHeader>
            </Card>

            {issuedCertificates.slice(0, 5).map((cert) => (
              <Card key={cert.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold">{cert.certificateTitle}</p>
                      <p className="text-sm text-gray-600">{cert.studentName}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(cert.issueDate).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant={cert.status === "issued" ? "default" : "secondary"}>
                      {cert.status === "issued" ? (
                        <>
                          <CheckCircle className="w-3 h-3 mr-1" /> Issued
                        </>
                      ) : (
                        "Pending"
                      )}
                    </Badge>
                  </div>
                  <div className="flex gap-2 mt-2 w-full">
                    {cert.qrCode && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => downloadQRCode(cert.qrCode!, cert.certificateTitle)}
                      >
                        <QrCode className="w-4 h-4 mr-2" /> Download QR
                      </Button>
                    )}
                    {cert.transactionHash && cert.status === "issued" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          const hash = generateVerificationHash("cert", cert.transactionHash!);
                          navigator.clipboard.writeText(hash);
                          toast({ description: "Verification hash copied to clipboard!" });
                        }}
                      >
                        <Copy className="w-4 h-4 mr-2" /> Copy Hash
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Award Tokens Tab */}
        <TabsContent value="tokens">
          <Card>
            <CardHeader>
              <CardTitle>Award Tokens / Credits</CardTitle>
              <CardDescription>
                Give tokens to students for participation, achievement, or other activities
              </CardDescription>
            </CardHeader>
            <CardContent className="max-w-md">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Student Email *</label>
                  <Input
                    type="email"
                    placeholder="student@example.com"
                    value={awardData.studentEmail}
                    onChange={(e) =>
                      setAwardData({ ...awardData, studentEmail: e.target.value })
                    }
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Number of Tokens *</label>
                  <Input
                    type="number"
                    placeholder="10"
                    value={awardData.tokens}
                    onChange={(e) =>
                      setAwardData({
                        ...awardData,
                        tokens: parseInt(e.target.value) || 0,
                      })
                    }
                    min="1"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Reason (Optional)</label>
                  <Textarea
                    placeholder="Why are these tokens being awarded?"
                    value={awardData.reason}
                    onChange={(e) =>
                      setAwardData({ ...awardData, reason: e.target.value })
                    }
                    rows={3}
                  />
                </div>

                <Button
                  onClick={handleAwardTokens}
                  disabled={awardLoading}
                  className="w-full"
                  size="lg"
                >
                  {awardLoading ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      Awarding...
                    </>
                  ) : (
                    <>
                      <Award className="w-4 h-4 mr-2" />
                      Award Tokens
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default HeadIssuerDashboard;
