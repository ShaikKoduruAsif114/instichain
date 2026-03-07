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
  getDoc
} from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { getUsersByIds, voteOnProposalForUser, issueCertificateForApprovedUser } from "@/utils/firebaseHelpers";

const ClubProposals = () => {
  const { toast } = useToast();
  const [clubId, setClubId] = useState<string | null>(null);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [adminName, setAdminName] = useState<string>("Club Admin");
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
      // For each proposal, load basic user display info
      const enriched = await Promise.all(
        docs.map(async (p) => {
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
          toast({ title: "✅ User approved! Issuing certificate..." });
          // Auto-issue certificate on-chain after approval
          try {
            await issueCertificateForApprovedUser(targetUid, res.eventId, adminName);
            toast({ title: "🎓 Certificate issued on blockchain!", description: "The student can now see it in their dashboard." });
          } catch (certErr: any) {
            console.error("Certificate issuance failed:", certErr);
            toast({ title: "⚠️ Tokens awarded but certificate failed", description: certErr.message, variant: "destructive" });
          }
        } else {
          toast({ title: "Vote recorded", description: `${res.voteCount} / ${proposal.requiredVotes} votes` });
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
