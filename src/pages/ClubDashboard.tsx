import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { auth, db } from "@/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  addDoc,
  getDocs,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Calendar, Trophy, Wallet, ShieldCheck, Share2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import ConnectWallet from "@/components/ConnectWallet";
import { verifyAdminByWallet, AdminToken, generateVerificationHash } from "@/lib/blockchain";
import { generateWalletQRCode } from "@/lib/qrcode";
import { toast } from "@/hooks/use-toast";
import { QrCode } from "lucide-react";
import { getUsersByIds } from "@/utils/firebaseHelpers";

const ClubDashboard = () => {
  const navigate = useNavigate();

  const [clubId, setClubId] = useState<string | null>(null);
  const [clubAdmins, setClubAdmins] = useState<string[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Track proposals per event: eventId -> proposal data
  const [proposalByEvent, setProposalByEvent] = useState<Record<string, any>>({});

  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [participantData, setParticipantData] = useState<Record<string, any>>({});

  // Wallet state for display
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<AdminToken | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);

  // 🔐 Auth + role check
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        navigate("/signin");
        return;
      }

      const snap = await getDoc(doc(db, "users", u.uid));
      if (!snap.exists() || snap.data().role !== "club") {
        navigate("/dashboard");
        return;
      }

      const data = snap.data();
      const cid = data.clubId;
      setClubId(cid);
      setWalletAddress(data.walletAddress || null);

      const clubSnap = await getDoc(doc(db, "clubs", cid));
      if (clubSnap.exists()) {
        setClubAdmins(clubSnap.data().admins || []);
      }
    });

    return () => unsub();
  }, [navigate]);

  // Load Admin Token from Blockchain
  useEffect(() => {
    const fetchAdminToken = async () => {
      if (!walletAddress) return;
      setLoadingToken(true);
      try {
        const { adminToken: token, isValid } = await verifyAdminByWallet(walletAddress);
        if (isValid) {
          setAdminToken(token);
          const qr = await generateWalletQRCode(walletAddress);
          setQrCodeUrl(qr);
        }
      } catch (err) {
        console.error("No valid admin token found", err);
      } finally {
        setLoadingToken(false);
      }
    };
    fetchAdminToken();
  }, [walletAddress]);

  // 📡 Load club events
  useEffect(() => {
    if (!clubId) return;

    const q = query(collection(db, "events"), where("clubId", "==", clubId));
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => unsub();
  }, [clubId]);

  // 📡 Load existing proposals to know which events already have one
  useEffect(() => {
    if (!clubId) return;

    const q = query(collection(db, "rewardProposals"), where("clubId", "==", clubId));
    const unsub = onSnapshot(q, (snap) => {
      const byEvent: Record<string, any> = {};
      snap.docs.forEach(d => {
        const data = d.data() as any;
        byEvent[data.eventId] = { id: d.id, ...data };
      });
      setProposalByEvent(byEvent);
    });

    return () => unsub();
  }, [clubId]);

  // Load user data for participants of the selected event
  useEffect(() => {
    if (!selectedEvent || !selectedEvent.participants?.length) return;

    const fetchParticipants = async () => {
      try {
        const users = await getUsersByIds(selectedEvent.participants);
        const pData: Record<string, any> = {};
        users.forEach(u => {
          pData[u.uid] = u;
        });
        setParticipantData(pData);
      } catch (err) {
        console.error("Failed to load participants", err);
      }
    };
    fetchParticipants();
  }, [selectedEvent]);

  // 🧮 Majority rule
  const requiredVotes =
    clubAdmins.length === 1 ? 1 :
      clubAdmins.length === 2 ? 2 : 2;

  // 🗳 Create reward proposal
  const createProposal = async () => {
    if (!selectedEvent || selectedUsers.length === 0) return;

    // Double-check (real-time state already hides the button, but guard here too)
    if (proposalByEvent[selectedEvent.id]) {
      alert("A reward proposal for this event already exists. Go to 'Reward Proposals' to vote on it.");
      setSelectedEvent(null);
      setSelectedUsers([]);
      return;
    }

    await addDoc(collection(db, "rewardProposals"), {
      eventId: selectedEvent.id,
      eventName: selectedEvent.name,
      clubId,
      users: selectedUsers,
      tokens: selectedEvent.tokens,
      votes: {},
      approved: false,
      approvedUsers: [],
      requiredVotes,
      createdAt: serverTimestamp()
    });

    setSelectedEvent(null);
    setSelectedUsers([]);
    alert("Reward proposal submitted for voting. Other admins can now vote on it.");
  };

  if (loading) return <div className="p-10">Loading club…</div>;

  return (
    <div className="container mx-auto p-8 space-y-6">

      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Club Dashboard</h1>

        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link to="/club/proposals">Reward Proposals</Link>
          </Button>

          <Button asChild>
            <Link to="/club/new-event">
              <Plus className="w-4 h-4 mr-2" />
              Create Event
            </Link>
          </Button>
        </div>
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
                  No wallet linked — students need a wallet to receive certificates
                </div>
              )}
            </div>
            <ConnectWallet initialAddress={walletAddress} />
          </div>
        </CardContent>
      </Card>

      {/* Admin NFT Credentials */}
      {walletAddress && (
        <Card className={adminToken ? "border-green-200 bg-green-50 dark:bg-green-950/20" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className={`w-5 h-5 ${adminToken ? "text-green-600" : "text-gray-400"}`} />
              Admin NFT Credentials
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingToken ? (
              <p className="text-sm text-muted-foreground">Checking blockchain for credentials...</p>
            ) : adminToken ? (
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                <div>
                  <div className="font-semibold text-green-900 dark:text-green-400">
                    Verified {adminToken.clubName} Admin
                  </div>
                  <div className="text-sm text-green-700 dark:text-green-500 mt-1">
                    Issued to: {adminToken.adminName}
                  </div>
                  <div className="text-xs text-green-600 dark:text-green-600/80 mt-1 border-b border-green-200 pb-3 mb-3">
                    Since: {new Date(adminToken.issueDate * 1000).toLocaleDateString()}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/verify?wallet=${walletAddress}`);
                      toast({ title: "Verification link copied!" });
                    }}>
                      <Share2 className="w-4 h-4 mr-2" />
                      Copy Link
                    </Button>
                    {qrCodeUrl && (
                      <Button variant="outline" size="sm" onClick={() => {
                        const link = document.createElement("a");
                        link.href = qrCodeUrl;
                        link.download = "admin-verification-qr.png";
                        link.click();
                      }}>
                        <QrCode className="w-4 h-4 mr-2" />
                        Save QR
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => {
                      const hash = generateVerificationHash("admin", walletAddress);
                      navigator.clipboard.writeText(hash);
                      toast({ title: "Admin Verification Hash copied!" });
                    }}>
                      <ShieldCheck className="w-4 h-4 mr-2" />
                      Copy Hash
                    </Button>
                  </div>
                </div>
                {qrCodeUrl && (
                  <div className="flex flex-col items-center bg-white p-2 rounded-lg border shadow-sm">
                    <img src={qrCodeUrl} alt="Verification QR Code" className="w-24 h-24" />
                    <span className="text-[10px] text-muted-foreground mt-1">Scan to verify</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                <p>No Admin NFT found attached to this wallet.</p>
                <p className="text-xs mt-1">Make sure you are connected with the wallet the Head authorized you with.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Events */}
      {events.map(ev => (
        <Card key={ev.id}>
          <CardHeader>
            <CardTitle>{ev.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" /> {ev.date}
            </div>

            {ev.status !== "completed" && (
              <Button
                variant="outline"
                onClick={async () => {
                  await updateDoc(doc(db, "events", ev.id), {
                    status: "completed"
                  });
                }}
              >
                Mark Completed
              </Button>
            )}

            {ev.status === "completed" && (() => {
              const proposal = proposalByEvent[ev.id];

              if (!proposal) {
                // No proposal yet — allow creation
                return (
                  <Button
                    className="bg-token text-token-foreground"
                    onClick={() => setSelectedEvent(ev)}
                  >
                    <Trophy className="w-4 h-4 mr-2" />
                    Create Reward Proposal
                  </Button>
                );
              }

              // Proposal exists — check if fully approved and certificates minted
              const totalUsers = proposal.users?.length || 0;
              const approvedUsers = proposal.approvedUsers?.length || 0;
              const allApproved = totalUsers > 0 && totalUsers === approvedUsers;
              const allMinted = allApproved || (proposal.approved && proposal.status === "issued");

              if (allMinted) {
                // Fully done — disable button
                return (
                  <div className="flex items-center gap-3">
                    <Button variant="outline" disabled className="opacity-80 cursor-not-allowed border-green-200 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                      <Trophy className="w-4 h-4 mr-2" />
                      Certificates Issued ✓
                    </Button>
                  </div>
                );
              }

              // Proposal exists but not yet completely approved — show vote status
              return (
                <div className="flex items-center gap-3">
                  <Button variant="outline" disabled className="opacity-60 cursor-not-allowed">
                    <Trophy className="w-4 h-4 mr-2" />
                    Voting in progress ({approvedUsers}/{totalUsers} approved)
                  </Button>
                  <Button asChild variant="secondary" size="sm">
                    <Link to="/club/proposals">Go vote →</Link>
                  </Button>
                </div>
              );
            })()}

          </CardContent>
        </Card>
      ))}

      {/* Proposal Modal */}
      {selectedEvent && (
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">
            Reward Proposal – {selectedEvent.name}
          </h2>

          <p className="text-sm text-muted-foreground mb-3">
            Select participants who attended and deserve a reward:
          </p>

          {Array.isArray(selectedEvent.participants) && selectedEvent.participants.length > 0 ? (
            selectedEvent.participants.map((uid: string) => {
              const u = participantData[uid] || { name: uid, email: "" };
              return (
                <div key={uid} className="flex items-center space-x-2 mb-2 p-2 rounded hover:bg-muted/50">
                  <Checkbox
                    checked={selectedUsers.includes(uid)}
                    onCheckedChange={(v) =>
                      v
                        ? setSelectedUsers([...selectedUsers, uid])
                        : setSelectedUsers(selectedUsers.filter(id => id !== uid))
                    }
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{u.name || u.displayName || u.email || uid}</span>
                    <span className="text-xs text-muted-foreground">{u.email || uid}</span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No registered participants for this event.</p>
          )}

          <div className="flex gap-3 mt-4">
            <Button onClick={createProposal} disabled={selectedUsers.length === 0}>
              Submit Proposal
            </Button>
            <Button variant="outline" onClick={() => { setSelectedEvent(null); setSelectedUsers([]); }}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

    </div>
  );
};

export default ClubDashboard;
