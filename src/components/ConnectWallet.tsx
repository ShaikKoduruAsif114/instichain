// src/components/ConnectWallet.tsx
import React, { useState } from "react";
import { ethers } from "ethers";
import { auth, db } from "../firebaseConfig";
import { doc, setDoc } from "firebase/firestore";

/**
 * ConnectWallet:
 * - Connects to MetaMask (window.ethereum).
 * - Requests user to sign a short nonce message to prove ownership.
 * - Verifies the signature client-side (recovers address).
 * - If the recovered address matches the connected address, saves walletAddress to Firestore (users/{uid}).
 *
 * This does NOT send or store private keys.
 */

export default function ConnectWallet({ initialAddress }: { initialAddress?: string | null }) {
  const [loading, setLoading] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(initialAddress || null);

  const connect = async () => {
    if (!window.ethereum) {
      alert("MetaMask not found. Please install MetaMask and try again.");
      return;
    }

    setLoading(true);
    try {
      // Request accounts from MetaMask
      const provider = new ethers.BrowserProvider(window.ethereum!);

      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setConnectedAddress(address);

      // Create a short nonce message to sign (this prevents replay)
      const nonce = `Connect to Insti Chain — nonce:${Math.floor(Math.random() * 1e9)}`;
      // Ask the user to sign the nonce
      const signature = await signer.signMessage(nonce);

      // Recover address from signature and message
      const recovered = ethers.verifyMessage(nonce, signature);

      if (recovered.toLowerCase() !== address.toLowerCase()) {
        alert("Signature verification failed. Please try again.");
        setLoading(false);
        return;
      }

      // Save wallet address to Firestore under users/{uid}
      const user = auth.currentUser;
      if (!user) {
        alert("You must be signed in to link a wallet.");
        setLoading(false);
        return;
      }

      await setDoc(doc(db, "users", user.uid), { walletAddress: address }, { merge: true });
      alert("Wallet linked successfully!");
    } catch (err: any) {
      console.error("wallet connect error", err);
      alert(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={connect}
        disabled={loading || !!connectedAddress}
        className={`px-4 py-2 rounded text-white ${connectedAddress ? 'bg-green-600 cursor-not-allowed' : 'bg-blue-600'}`}
      >
        {loading ? "Connecting…" : connectedAddress ? "Wallet Linked ✓" : "Connect with MetaMask"}
      </button>

      {connectedAddress && (
        <div className="text-sm text-muted-foreground">
          Connected: <span className="font-mono">{connectedAddress}</span>
        </div>
      )}
    </div>
  );
}
