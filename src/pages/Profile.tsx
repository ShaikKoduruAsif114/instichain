// src/pages/Profile.tsx
import React, { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, db } from "../firebaseConfig";
import { useNavigate } from "react-router-dom";
import { doc, getDoc, setDoc } from "firebase/firestore";
import ConnectWallet from "@/components/ConnectWallet";

const Profile: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        navigate("/signin");
        return;
      }
      setUser(u);

      try {
        const userDoc = await getDoc(doc(db, "users", u.uid));
        if (userDoc.exists()) {
          const data = userDoc.data() as any;
          if (data.walletAddress) setWallet(data.walletAddress);
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      }
    });
    return () => unsub();
  }, [navigate]);

  if (!user) return null;

  const handleSaveManual = async () => {
    // Manual save (fallback)
    if (!wallet) {
      alert("Enter a wallet address or use Connect with MetaMask.");
      return;
    }
    setLoading(true);
    try {
      await setDoc(doc(db, "users", user.uid), { walletAddress: wallet }, { merge: true });
      alert("Wallet saved.");
    } catch (err) {
      console.error(err);
      alert("Failed to save wallet.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-4">Profile</h1>

      <div className="max-w-md border rounded p-6 space-y-4">
        <div>
          <div className="text-sm text-muted-foreground">Email</div>
          <div className="font-medium">{user.email}</div>
        </div>

        <div>
          <div className="text-sm text-muted-foreground">Email Verified</div>
          <div>{user.emailVerified ? "Yes" : "No"}</div>
        </div>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">Link a wallet (recommended)</div>
          <ConnectWallet initialAddress={wallet} />
        </div>

        <div className="mt-2">
          <div className="text-sm text-muted-foreground">Or enter wallet manually (fallback)</div>
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x...."
            className="w-full p-2 border rounded mt-1"
          />
          <div className="flex gap-3 mt-3">
            <button
              onClick={handleSaveManual}
              disabled={loading}
              className="px-4 py-2 rounded bg-blue-600 text-white"
            >
              Save
            </button>
            <button onClick={() => navigate("/dashboard")} className="px-4 py-2 rounded border">
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
