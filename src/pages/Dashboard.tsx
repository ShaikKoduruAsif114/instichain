// src/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebaseConfig";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import ConnectWallet from "@/components/ConnectWallet";

import {
  Calendar,
  LayoutDashboard,
  Award,
  FileText,
  Wallet,
  QrCode,
  Share2
} from "lucide-react";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  QueryDocumentSnapshot,
  DocumentData
} from "firebase/firestore";

import { useToast } from "@/hooks/use-toast";
import { generateCertificateQRCode } from "@/lib/qrcode";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type EventItem = {
  id: string;
  name: string;
  date?: string; // YYYY-MM-DD OR may be missing
  rawDate?: any; // original field, might be Timestamp
  participants?: string[];
  attendees?: string[];
  [k: string]: any;
  status?: "upcoming" | "ongoing" | "completed";
};

const Dashboard = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [registeredEvents, setRegisteredEvents] = useState<EventItem[]>([]);
  const [attendedEvents, setAttendedEvents] = useState<EventItem[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<EventItem[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);

  const { toast } = useToast();
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [selectedCertForQr, setSelectedCertForQr] = useState<any | null>(null);

  // Convert various date formats to 'YYYY-MM-DD' string
  const toDateString = (raw: any): string | null => {
    if (!raw && raw !== 0) return null;
    // Firestore Timestamp has toDate function
    if (raw?.toDate && typeof raw.toDate === "function") {
      return raw.toDate().toISOString().split("T")[0];
    }
    // If stored as ISO string
    if (typeof raw === "string" && raw.includes("T")) {
      return raw.split("T")[0];
    }
    // If stored as 'YYYY-MM-DD' already
    if (typeof raw === "string") {
      return raw;
    }
    // If stored as number (unix ms)
    if (typeof raw === "number") {
      return new Date(raw).toISOString().split("T")[0];
    }
    return null;
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/signin");
        return;
      }

      try {
        // load user doc
        const userSnap = await getDoc(doc(db, "users", user.uid));
        let userObj: any = {
          id: user.uid,
          name: user.displayName || user.email,
          email: user.email,
          tokens: 0,
          participatedEvents: [],
        };

        if (userSnap.exists()) {
          const data = userSnap.data() as any;
          userObj = {
            ...userObj,
            ...data,
            id: user.uid,
          };
        }

        setCurrentUser(userObj);
        setWalletAddress(userObj.walletAddress || null);

        // load all events (we'll filter locally)
        const eventsCol = collection(db, "events");
        const qSnap = await getDocs(eventsCol);

        const allEvents: EventItem[] = qSnap.docs.map((d: QueryDocumentSnapshot<DocumentData>) => {
          const data = d.data();
          const rawDate = data.date ?? null;
          const dateStr = toDateString(rawDate ?? data.dateString ?? null);
          return {
            id: d.id,
            name: data.name ?? "(no name)",
            date: dateStr ?? "",
            rawDate,
            participants: data.participants ?? [],
            attendees: data.attendees ?? [],
            ...data
          } as EventItem;
        });

        // determine status for each event
        const today = new Date().toISOString().split("T")[0];
        const eventsWithStatus = allEvents.map((ev) => {
          const d = ev.date ?? "";
          if (!d) return { ...ev, status: "upcoming" as const }; // unknown => upcoming
          if (d < today) return { ...ev, status: "completed" as const };
          if (d === today) return { ...ev, status: "ongoing" as const };
          return { ...ev, status: "upcoming" as const };
        });

        setEvents(eventsWithStatus);

        // find events where user is participant / attendee
        const uid = user.uid;
        const regs = eventsWithStatus.filter((e) => (e.participants ?? []).includes(uid));
        const atts = eventsWithStatus.filter((e) => (e.attendees ?? []).includes(uid));
        const upc = eventsWithStatus.filter((e) => e.status === "upcoming" || e.status === "ongoing");

        setRegisteredEvents(regs);
        setAttendedEvents(atts);
        setUpcomingEvents(upc.slice(0, 3));

        // Load certificates earned by this user — query by uid OR email for full coverage
        const certsCol = collection(db, "certificates");
        const [certsByEmail, certsByUid] = await Promise.all([
          getDocs(query(certsCol, where("studentEmail", "==", userObj.email))),
          getDocs(query(certsCol, where("studentId", "==", user.uid)))
        ]);
        // Merge, deduplicate by doc id
        const certMap = new Map<string, any>();
        [...certsByEmail.docs, ...certsByUid.docs].forEach(d => {
          certMap.set(d.id, { id: d.id, ...d.data() });
        });
        const userCerts = Array.from(certMap.values());

        setCertificates(userCerts);
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [navigate]);

  const calculateProgress = () => {
    const tokens = Number(currentUser?.tokens ?? 0);
    // example: 100 tokens = 100% progress
    return Math.min((tokens / 100) * 100, 100);
  };

  if (loading) return <div className="p-8">Loading dashboard...</div>;
  if (!currentUser) return null;

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Welcome back, {currentUser.name} 👋</h1>
        <p className="text-muted-foreground">Track events and earn rewards</p>
      </div>

      {/* Wallet Banner */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <Wallet className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 sm:mt-0" />
            <div className="flex-1">
              <div className="font-medium text-sm">MetaMask Wallet</div>
              {walletAddress ? (
                <div className="text-xs text-muted-foreground font-mono">
                  Connected: {walletAddress.slice(0, 10)}…{walletAddress.slice(-6)}
                </div>
              ) : (
                <div className="text-xs text-orange-600">
                  No wallet linked — you need a wallet to receive certificates
                </div>
              )}
            </div>
            <ConnectWallet initialAddress={walletAddress} />
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Tokens</p>
            <p className="text-3xl font-bold">{currentUser.tokens ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Registered</p>
            <p className="text-3xl font-bold">{registeredEvents.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Attended</p>
            <p className="text-3xl font-bold">{attendedEvents.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Upcoming</p>
            <p className="text-3xl font-bold">{upcomingEvents.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Your Progress</CardTitle>
          <CardDescription>Earn more tokens</CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={calculateProgress()} />
        </CardContent>
      </Card>

      {/* Certificates Earned */}
      <Card>
        <CardHeader className="flex flex-row justify-between">
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5" /> Certificates Earned
          </CardTitle>
          <Button asChild variant="ghost">
            <Link to="/certificates">View All</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {certificates.length === 0 ? (
            <p className="text-muted-foreground">No certificates earned yet</p>
          ) : (
            certificates.map((cert) => (
              <div key={cert.id} className="p-3 border rounded mb-2">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-medium">{cert.certificateTitle}</p>
                    <p className="text-sm text-muted-foreground">
                      Issued by: {cert.issuerName || "Unknown"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {cert.issueDate
                        ? new Date(cert.issueDate).toLocaleDateString()
                        : "Date not available"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant={cert.status === "issued" ? "default" : "secondary"}>
                      {cert.status}
                    </Badge>
                    {cert.status === "issued" && cert.certificateId && (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => {
                          const url = `${window.location.origin}/verify/${cert.certificateId}`;
                          navigator.clipboard.writeText(url);
                          toast({ description: "Verification link copied!" });
                        }}>
                          <Share2 className="w-3 h-3 mr-1" />
                          Link
                        </Button>
                        <Button variant="outline" size="sm" onClick={async () => {
                          setSelectedCertForQr(cert);
                          try {
                            const qr = await generateCertificateQRCode(cert.certificateId);
                            setQrCodeUrl(qr);
                          } catch (err) {
                            console.error("Failed to generate QR for cert", err);
                          }
                        }}>
                          <QrCode className="w-3 h-3 mr-1" />
                          QR
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* QR Code Dialog */}
      <Dialog open={!!selectedCertForQr} onOpenChange={(open) => {
        if (!open) {
          setSelectedCertForQr(null);
          setQrCodeUrl(null);
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Verification QR Code</DialogTitle>
            <DialogDescription>Scan to verify {selectedCertForQr?.certificateTitle}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-6 space-y-4">
            {qrCodeUrl ? (
              <>
                <div className="p-4 bg-white rounded-xl border shadow-sm">
                  <img src={qrCodeUrl} alt="Certificate QR" className="w-48 h-48" />
                </div>
                <Button onClick={() => {
                  const link = document.createElement("a");
                  link.href = qrCodeUrl;
                  link.download = `certificate-${selectedCertForQr?.certificateId}-qr.png`;
                  link.click();
                }} className="w-full">
                  <QrCode className="w-4 h-4 mr-2" />
                  Save QR Code
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">Loading QR Code...</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Registered Events */}
      <Card>
        <CardHeader className="flex flex-row justify-between">
          <CardTitle>Registered Events</CardTitle>
          <Button asChild variant="ghost">
            <Link to="/events">View All</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {registeredEvents.length === 0 ? (
            <p className="text-muted-foreground">No registered events</p>
          ) : (
            registeredEvents.map((event) => (
              <div key={event.id} className="p-3 border rounded mb-2">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{event.name}</p>
                    <div className="text-sm text-muted-foreground">{event.date}</div>
                  </div>
                  <Badge>{event.status}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div >
  );
};

export default Dashboard;
