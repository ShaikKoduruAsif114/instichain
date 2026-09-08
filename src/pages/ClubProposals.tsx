// src/pages/ClubProposals.tsx
import { useEffect, useState } from "react";
import { auth, db } from "@/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  serverTimestamp,
  addDoc,
  updateDoc,
} from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { getUsersByIds, voteOnProposalForUser, issueCertificateForApprovedUser } from "@/utils/firebaseHelpers";
import ConnectWallet from "@/components/ConnectWallet";
import { Wallet } from "lucide-react";
import { issueCertificate as issueCertificateOnChain } from "@/lib/blockchain";
import { uploadToIPFS, placeholderCIDFor } from "@/lib/ipfs";
import { generateSampleCertificatePDF } from "@/lib/pdfGenerator";

const ClubProposals = () => {
  const { toast } = useToast();
  const [clubId, setClubId] = useState<string | null>(null);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [adminName, setAdminName] = useState<string>("Club Admin");
  const [adminWalletAddress, setAdminWalletAddress] = useState<string | null>(null);
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setAdminId(null);
        setClubId(null);
        setLoading(false);
        return;
      }

      setAdminId(u.uid);
      const snap = await getDoc(doc(db, "users", u.uid));
      if (!snap.exists()) {
        setClubId(null);
        setLoading(false);
        return;
      }

      const data: any = snap.data();
      setAdminName(data.name || data.email || "Club Admin");
      if (data.walletAddress) {
        setAdminWalletAddress(data.walletAddress);
      }

      if (data.role !== "club") {
        setClubId(null);
        setLoading(false);
        return;
      }

      setClubId(data.clubId);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!clubId) return;
    const q = query(
      collection(db, "rewardProposals"),
      where("clubId", "==", clubId),
      where("approved", "==", false) // you may keep this or filter on approvedUsers; adjust as needed
    );

    const unsub = onSnapshot(q, async (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

      // Filter out proposals where all users are already approved
      const pendingDocs = docs.filter(p => {
        const totalUsers = p.users?.length || 0;
        const approvedUsers = p.approvedUsers?.length || 0;
        if (totalUsers === 0) return true; // keep empty proposals
        return approvedUsers < totalUsers;
      });

      // For each pending proposal, load basic user display info
      const enriched = await Promise.all(
        pendingDocs.map(async (p) => {
          const users = Array.isArray(p.users) ? p.users : [];
          const userDocs = await getUsersByIds(users);
          // build map uid -> { name, email }
          const userMap: Record<string, any> = {};
          userDocs.forEach((ud) => {
            userMap[ud.uid] = ud;
          });
          return { ...p, userMap };
        })
      );
      setProposals(enriched);
    });

    return () => unsub();
  }, [clubId]);

  const handleApproveForUser = async (proposal: any, targetUid: string) => {
    if (!adminId) {
      toast({ title: "Sign in as admin", variant: "destructive" });
      return;
    }

    try {
      const res: any = await voteOnProposalForUser(proposal.id, targetUid, adminId);
      if (res.status === "already-voted") {
        toast({ title: "You already voted for this user" });
        return;
      }
      if (res.status === "already-approved") {
        toast({ title: "User already approved" });
        return;
      }
      if (res.status === "ok") {
        if (res.approved) {
          const u = proposal.userMap?.[targetUid] || { name: targetUid, email: "" };
          const walletAddress = u.walletAddress || u.wallet;

          if (!walletAddress) {
            toast({ title: "✅ Votes complete!", description: "Student has no wallet linked! Added to pending queue.", variant: "destructive" });
            await issueCertificateForApprovedUser(targetUid, proposal.eventId, adminName);
          } else {
            toast({ title: "✅ Votes complete! Minting certificate on blockchain..." });
            try {
              const studentName = u.name || u.displayName || u.email || targetUid;
              const courseName = proposal.eventName || proposal.eventId || "Club Event";

              // Generate PDF for the certificate; fall back to an explicit
              // no-document sentinel (never an invalid CID, which would revert on-chain)
              let ipfsHash = placeholderCIDFor(`proposal:${proposal.eventId}:${targetUid}`);
              try {
                const pdf = await generateSampleCertificatePDF({
                  studentName,
                  courseName,
                  issuerName: adminName,
                  eventName: proposal.eventName,
                  date: new Date().toISOString(),
                });
                ipfsHash = await uploadToIPFS(pdf);
              } catch (pdfErr) {
                console.warn("PDF generation failed, using placeholder", pdfErr);
              }

              const certId = await issueCertificateOnChain(
                walletAddress,
                studentName,
                courseName,
                adminName,
                ipfsHash
              );

              // Save directly as issued
              await addDoc(collection(db, "certificates"), {
                studentId: targetUid,
                studentEmail: u.email || "",
                studentName,
                walletAddress,
                certificateTitle: courseName,
                issuerName: adminName,
                eventId: proposal.eventId,
                certificateId: certId,
                status: "issued",
                issueDate: new Date().toISOString(),
                createdAt: serverTimestamp(),
              });

              // ✅ Mark the rewardProposal as fully minted
              await updateDoc(doc(db, "rewardProposals", proposal.id), {
                status: "issued",
              });

              toast({ title: `🎓 Certificate #${certId} minted directly to student!` });
            } catch (mintErr: any) {
              console.error("Mint failed:", mintErr);
              toast({ title: "Minting failed", description: "Falling back to pending queue...", variant: "destructive" });
              await issueCertificateForApprovedUser(targetUid, proposal.eventId, adminName);
            }
          }
        } else {
          const voteCount = res.votes ?? res.voteCount ?? 1;
          toast({ title: "Vote recorded", description: `${voteCount} / ${proposal.requiredVotes} votes` });
        }
      }

    } catch (err: any) {
      console.error("Vote error:", err);
      toast({ title: "Failed", description: err?.message || "Could not submit vote", variant: "destructive" });
    }
  };

  if (loading) return <div className="p-8">Loading proposals...</div>;
  if (!clubId) return <div className="p-8">No club account detected.</div>;

  return (
    <div className="container mx-auto p-8 space-y-6">
      <h1 className="text-3xl font-bold">Reward Proposals</h1>

      {/* Wallet Banner — needed to issue certificates on-chain */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Wallet className="w-5 h-5 text-blue-600 shrink-0" />
          <div className="flex-1">
            <div className="font-medium text-sm">MetaMask Required for Certificate Issuance</div>
            <div className="text-xs text-muted-foreground">
              When a proposal reaches enough votes, a blockchain certificate is minted. Connect your wallet to sign the transaction.
            </div>
          </div>
          <ConnectWallet initialAddress={adminWalletAddress} />
        </div>
      </Card>

      {proposals.length === 0 && <p>No pending proposals.</p>}


      {proposals.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-sm text-muted-foreground">Event</div>
              <div className="font-medium">{p.eventId || p.eventName || "(unknown event)"}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Tokens per user: {p.tokens || 0} · Required votes: {p.requiredVotes || 1}
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {Array.isArray(p.users) && p.users.length > 0 ? (
              p.users.map((uid: string) => {
                const u = p.userMap?.[uid] || { name: uid, email: "" };
                const votesForUser = (p.votes && p.votes[uid]) ? Object.keys(p.votes[uid]).length : 0;
                const hasAdminVoted = !!(p.votes && p.votes[uid] && p.votes[uid][adminId!]);
                const isApproved = Array.isArray(p.approvedUsers) && p.approvedUsers.includes(uid);

                return (
                  <div key={uid} className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{u.name || u.displayName || u.email || uid}</div>
                      <div className="text-xs text-muted-foreground">{u.email || uid}</div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-sm text-muted-foreground">{votesForUser} votes</div>
                      <Button
                        onClick={() => handleApproveForUser(p, uid)}
                        disabled={!adminId || isApproved || hasAdminVoted}
                        variant={isApproved ? "secondary" : "default"}
                      >
                        {isApproved ? "Approved" : hasAdminVoted ? "Voted" : "Approve"}
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-muted-foreground">No users in this proposal</div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
};

export default ClubProposals;
