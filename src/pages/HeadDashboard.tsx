// src/pages/HeadDashboard.tsx
import { useEffect, useState } from "react";
import { auth, db } from "@/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  arrayUnion,
  arrayRemove
} from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import ConnectWallet from "@/components/ConnectWallet";
import { Wallet } from "lucide-react";
import { authorizeIssuerOnChain, removeIssuerOnChain } from "@/lib/blockchain";

type AdminUser = {
  uid: string;
  name?: string;
  email: string;
  walletAddress?: string;
};


type HeadUser = {
  id: string;
  email: string;
  role: "head";
  totalSupply: number;
  availableSupply: number;
  walletAddress?: string;
};

type Club = {
  id: string;
  name: string;
  admins: string[]; // uid list
};

const HeadDashboard = () => {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [headUser, setHeadUser] = useState<HeadUser | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);

  const [newClubName, setNewClubName] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const [searchResult, setSearchResult] = useState<any | null>(null);
  const [clubToDelete, setClubToDelete] = useState<Club | null>(null);

  const [adminUsers, setAdminUsers] = useState<Record<string, AdminUser[]>>({});
  const [adminAllocAmounts, setAdminAllocAmounts] = useState<Record<string, string>>({});

  const loadAll = async (uid: string) => {
    setLoading(true);
    try {
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists() || userSnap.data().role !== "head") {
        setAllowed(false);
        setLoading(false);
        return;
      }

      const data = userSnap.data();
      const head: HeadUser = {
        id: uid,
        email: data.email,
        role: "head",
        totalSupply: Number(data.totalSupply || 0),
        availableSupply: Number(data.availableSupply || 0),
        walletAddress: data.walletAddress
      };
      setHeadUser(head);

      const clubSnap = await getDocs(collection(db, "clubs"));
      const loadedClubs = clubSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Club));
      setClubs(loadedClubs);

      // Pre-load admin details for the club cards
      const newAdminUsers: Record<string, AdminUser[]> = {};
      await Promise.all(
        loadedClubs.map(async (club) => {
          if (!club.admins || club.admins.length === 0) {
            newAdminUsers[club.id] = [];
            return;
          }
          const users: AdminUser[] = [];
          for (const uid of club.admins) {
            const uSnap = await getDoc(doc(db, "users", uid));
            if (uSnap.exists()) {
              const d = uSnap.data();
              users.push({ uid, name: d.name, email: d.email });
            }
          }
          newAdminUsers[club.id] = users;
        })
      );
      setAdminUsers(newAdminUsers);

      setAllowed(true);
    } catch (err) {
      console.error("loadAll error", err);
      toast({ title: "Failed to load head dashboard", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setAllowed(false);
        setLoading(false);
        return;
      }
      loadAll(u.uid);
    });
    return () => unsub();
  }, []);

  /* ---------- Club CRUD ---------- */

  const createClub = async () => {
    if (!newClubName.trim()) {
      toast({ title: "Enter club name" });
      return;
    }
    try {
      const newDocRef = await addDoc(collection(db, "clubs"), {
        name: newClubName.trim(),
        admins: [],
        createdAt: serverTimestamp()
      });
      setNewClubName("");
      setClubs(prev => [...prev, { id: newDocRef.id, name: newClubName.trim(), admins: [] }]);
      toast({ title: "Club created" });
    } catch (err) {
      console.error("createClub", err);
      toast({ title: "Failed to create club", variant: "destructive" });
    }
  };

  const deleteClub = async (club: Club) => {
    try {
      await deleteDoc(doc(db, "clubs", club.id));
      toast({ title: "Club deleted" });
      setClubs(prev => prev.filter(c => c.id !== club.id));
      if (selectedClub?.id === club.id) setSelectedClub(null);
      setClubToDelete(null);
    } catch (err) {
      console.error("deleteClub", err);
      toast({ title: "Failed to delete", variant: "destructive" });
      setClubToDelete(null);
    }
  };

  /* ---------- Allocation ---------- */

  const allocateTokensToAdmin = async (adminUid: string, adminName: string) => {
    if (!headUser) return;
    const amountStr = adminAllocAmounts[adminUid];
    const amt = Number(amountStr);

    if (!amt || amt <= 0) return toast({ title: "Enter a valid amount" });
    if (amt > headUser.availableSupply) {
      return toast({ title: "Not enough supply", variant: "destructive" });
    }

    try {
      // 1. Deduct from Head
      await updateDoc(doc(db, "users", headUser.id), {
        availableSupply: headUser.availableSupply - amt
      });

      // 2. Add to Admin user document directly
      const adminRef = doc(db, "users", adminUid);
      const adminSnap = await getDoc(adminRef);
      const currentTokens = adminSnap.exists() ? (adminSnap.data().tokens || 0) : 0;

      await updateDoc(adminRef, {
        tokens: currentTokens + amt
      });

      toast({ title: `${amt} tokens allocated to ${adminName || "Admin"}` });

      // Clear input
      setAdminAllocAmounts(prev => ({ ...prev, [adminUid]: "" }));

      // Update local headUser state to avoid full reload
      setHeadUser(prev => prev ? {
        ...prev,
        availableSupply: prev.availableSupply - amt
      } : null);

    } catch (err) {
      console.error("allocateTokensToAdmin", err);
      toast({ title: "Allocation failed", variant: "destructive" });
    }
  };

  /* ---------- Admin management ---------- */

  const findUserByEmail = async (email: string) => {
    const q = query(collection(db, "users"), where("email", "==", email));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { uid: snap.docs[0].id, data: snap.docs[0].data() };
  };

  const addAdminToSelectedClub = async () => {
    if (!selectedClub) return toast({ title: "Select a club first" });
    if (!searchResult) return toast({ title: "Find user first" });

    try {
      if ((selectedClub.admins?.length || 0) >= 3) {
        return toast({ title: "Max 3 admins allowed", variant: "destructive" });
      }

      await updateDoc(doc(db, "clubs", selectedClub.id), {
        admins: arrayUnion(searchResult.uid)
      });

      await updateDoc(doc(db, "users", searchResult.uid), {
        role: "club",
        clubId: selectedClub.id
      });

      // ⛓️ Authorize the admin as a blockchain certificate issuer
      // The head's MetaMask (contract owner) must be the connected wallet
      const adminWallet: string | undefined = searchResult.data?.walletAddress;
      const adminName: string = searchResult.data?.name || searchResult.data?.email || "Admin";
      if (adminWallet) {
        try {
          toast({ title: "⛓️ Authorizing admin as certificate issuer on blockchain..." });
          await authorizeIssuerOnChain(adminWallet, adminName, selectedClub.name);
          toast({ title: "✅ Admin added & authorized as certificate issuer!" });
        } catch (chainErr: any) {
          // Don't block the admin add — just warn
          toast({
            title: "Admin added to Firestore ✓",
            description: `Blockchain authorization skipped: ${chainErr.message}. Admin must connect their wallet first, then you can authorize them on-chain.`,
            variant: "destructive"
          });
        }
      } else {
        toast({
          title: "Admin added to Firestore ✓",
          description: "Admin has no wallet linked yet. They must connect MetaMask first, then you can re-add or authorize them to mint NFTs."
        });
      }

      setSearchEmail("");
      setSearchResult(null);

      // Fetch the updated club to keep the manage panel open and updated
      const freshClubSnap = await getDoc(doc(db, "clubs", selectedClub.id));
      if (freshClubSnap.exists()) {
        const freshClub = { id: freshClubSnap.id, ...freshClubSnap.data() } as Club;
        setSelectedClub(freshClub);
        await loadAdminsForClub(freshClub);
        setClubs(prev => prev.map(c => c.id === freshClub.id ? freshClub : c));
      }

    } catch (err) {
      console.error("addAdminToSelectedClub", err);
      toast({ title: "Failed to add admin", variant: "destructive" });
    }
  };

  const manuallyAuthorizeAdminOnChain = async (adminUid: string, adminName: string, adminWallet?: string) => {
    if (!selectedClub) return;
    if (!adminWallet) {
      toast({ title: "No wallet linked", description: "Admin must connect MetaMask first. Go to their Profile to see.", variant: "destructive" });
      return;
    }

    try {
      toast({ title: "⛓️ Authorizing admin on blockchain..." });
      await authorizeIssuerOnChain(adminWallet, adminName, selectedClub.name);
      toast({ title: "✅ Admin authorized as certificate issuer!" });
    } catch (err: any) {
      console.error("Manual auth error", err);
      toast({ title: "Authorization failed", description: err.message, variant: "destructive" });
    }
  };


  const removeAdminFromSelectedClub = async (uid: string) => {
    if (!selectedClub) return;
    try {
      await updateDoc(doc(db, "clubs", selectedClub.id), {
        admins: arrayRemove(uid)
      });

      await updateDoc(doc(db, "users", uid), {
        role: "student",
        clubId: null
      });

      toast({ title: "Admin removed" });

      // Fetch the updated club to keep the manage panel open and updated
      const freshClubSnap = await getDoc(doc(db, "clubs", selectedClub.id));
      if (freshClubSnap.exists()) {
        const freshClub = { id: freshClubSnap.id, ...freshClubSnap.data() } as Club;
        setSelectedClub(freshClub);
        await loadAdminsForClub(freshClub);
        setClubs(prev => prev.map(c => c.id === freshClub.id ? freshClub : c));
      }

    } catch (err) {
      console.error("removeAdminFromSelectedClub", err);
      toast({ title: "Failed", variant: "destructive" });
    }
  };

  const findUser = async () => {
    if (!searchEmail.trim()) return toast({ title: "Enter email" });
    const u = await findUserByEmail(searchEmail.trim());
    if (!u) return toast({ title: "User not found" });
    setSearchResult({ uid: u.uid, ...u.data });
  };


  const loadAdminsForClub = async (club: Club) => {
    if (!club.admins || club.admins.length === 0) {
      setAdminUsers(prev => ({ ...prev, [club.id]: [] }));
      return;
    }

    const users: AdminUser[] = [];

    for (const uid of club.admins) {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) {
        const d = snap.data();
        users.push({
          uid,
          name: d.name,
          email: d.email,
          walletAddress: d.walletAddress,
        });
      }
    }

    setAdminUsers(prev => ({ ...prev, [club.id]: users }));
  };




  /* ---------- Transfer Head ---------- */

  const transferHeadRole = async (targetEmail: string) => {
    if (!headUser) return;
    if (!targetEmail.trim()) return toast({ title: "Enter new head email" });

    const found = await findUserByEmail(targetEmail.trim());
    if (!found) return toast({ title: "User not found" });

    const targetUid = found.uid;

    if (targetUid === headUser.id) return toast({ title: "You are already head" });

    try {
      await updateDoc(doc(db, "users", headUser.id), {
        role: "student"
      });

      await updateDoc(doc(db, "users", targetUid), {
        role: "head",
        totalSupply: headUser.totalSupply || 0,
        availableSupply: headUser.availableSupply || 0
      });

      toast({ title: "Head transferred" });

      if (auth.currentUser && auth.currentUser.uid === targetUid) {
        await loadAll(targetUid);
      } else {
        setHeadUser(null);
        setAllowed(false);
      }
    } catch (err) {
      console.error("transferHeadRole", err);
      toast({ title: "Transfer failed", variant: "destructive" });
    }
  };

  if (loading) return <div className="p-10">Loading head panel...</div>;
  if (!allowed) return <div className="p-10">Access denied (must be head)</div>;

  return (
    <div className="container p-8 space-y-6">
      <h1 className="text-3xl font-bold">Head Control Panel</h1>

      {/* Wallet Banner */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <Wallet className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 sm:mt-0" />
            <div className="flex-1">
              <div className="font-medium text-sm">MetaMask Wallet</div>
              <div className="text-xs text-muted-foreground">Link your wallet to interact with the blockchain</div>
            </div>
            <ConnectWallet initialAddress={headUser?.walletAddress} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Head supply</div>
              <div className="font-medium text-lg">{headUser?.availableSupply} / {headUser?.totalSupply}</div>
            </div>

            <div className="w-1/3">
              <Input
                placeholder="Transfer head to (email)"
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                className="mb-2"
              />
              <Button onClick={() => transferHeadRole(searchEmail)}>Transfer Head</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Create club</CardTitle></CardHeader>
        <CardContent className="flex gap-3">
          <Input value={newClubName} onChange={(e) => setNewClubName(e.target.value)} placeholder="Club name (e.g., WebOps Club IITM)" />
          <Button onClick={createClub}>Create</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {clubs.map(c => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle>{c.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="font-medium">Admins: {(c.admins || []).length}</div>
                {adminUsers[c.id]?.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {adminUsers[c.id].map(u => (
                      <div key={u.uid} className="text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded w-fit">
                        {u.name || u.email}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2 mb-3">
                <Button onClick={() => {
                  setSelectedClub(c);
                  loadAdminsForClub(c);
                }}>
                  Manage
                </Button>

                <Button variant="destructive" onClick={() => setClubToDelete(c)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* In-page delete confirmation dialog */}
      {clubToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 space-y-4">
            <h2 className="text-lg font-bold">Delete Club</h2>
            <p className="text-muted-foreground">
              Are you sure you want to delete <strong>{clubToDelete.name}</strong>? This will remove the club document but not the users.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setClubToDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => deleteClub(clubToDelete)}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      {selectedClub && (
        <Card>
          <CardHeader><CardTitle>Manage – {selectedClub.name}</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-4">
              <div className="font-medium">Admins</div>
              {(adminUsers[selectedClub.id]?.length || 0) === 0 && (
                <div className="text-sm text-muted-foreground">No admins yet</div>
              )}

              {(adminUsers[selectedClub.id] || []).map((u) => (
                <div key={u.uid} className="flex flex-col sm:flex-row justify-between items-start sm:items-center py-3 border-b gap-3 sm:gap-0">
                  <div>
                    <div className="font-medium">{u.name || "Unnamed"}</div>
                    <div className="text-sm text-muted-foreground">{u.email}</div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                    <div className="flex gap-2 items-center">
                      <Input
                        placeholder="Allocate tokens"
                        value={adminAllocAmounts[u.uid] || ""}
                        onChange={(e) => setAdminAllocAmounts(prev => ({ ...prev, [u.uid]: e.target.value }))}
                        className="w-32"
                      />
                      <Button size="sm" onClick={() => allocateTokensToAdmin(u.uid, u.name || "Admin")}>
                        Send
                      </Button>
                    </div>
                    <div className="flex gap-2 items-center mt-2 sm:mt-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => manuallyAuthorizeAdminOnChain(u.uid, u.name || u.email || "Admin", u.walletAddress)}
                        title="Authorize to mint NFTs on Blockchain"
                      >
                        Authorize NFT Minting
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => removeAdminFromSelectedClub(u.uid)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

            </div>

            <div className="mb-4">
              <div className="flex gap-2 items-center">
                <Input placeholder="Find user by email" value={searchEmail} onChange={(e) => setSearchEmail(e.target.value)} />
                <Button onClick={findUser}>Find</Button>
              </div>

              {searchResult && (
                <div className="mt-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{searchResult.name ?? searchResult.email}</div>
                    <div className="text-sm text-muted-foreground">{searchResult.email}</div>
                  </div>
                  <div>
                    <Button onClick={addAdminToSelectedClub}>Add as admin</Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default HeadDashboard;
