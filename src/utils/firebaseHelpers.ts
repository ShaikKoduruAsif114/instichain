// src/utils/firebaseHelpers.ts
import { db } from "@/firebaseConfig";
import { issueCertificate } from "@/lib/blockchain";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  addDoc,
  DocumentData,
  increment,
  updateDoc
} from "firebase/firestore";


export type AppUser = {
  uid: string;
  name?: string;
  email?: string;
  role?: "student" | "club" | "head" | "recruiter" | string;
  walletAddress?: string | null;
  clubId?: string | null;
  tokens?: number;
  rewardedEvents?: string[];
  registeredEvents?: string[];
  [k: string]: any;
};


// add at top with other imports
// import {
//   runTransaction,
//   increment,
//   arrayUnion,
//   arrayRemove // keep if you still use it elsewhere
// } from "firebase/firestore";

/**
 * Fetch several user docs by UID (returns array of { uid, name, email, ... })
 */
export async function getUsersByIds(uids: string[]) {
  // small optimization: if no uids, return []
  if (!uids || uids.length === 0) return [];

  // fetch documents in parallel (works for reasonably sized lists)
  const promises = uids.map((uid) => getDoc(doc(db, "users", uid)));
  const snaps = await Promise.all(promises);
  return snaps.map((s) => ({ uid: s.id, ...(s.data() || {}) }));
}

/**
 * Cast a vote for a single user inside a proposal.
 * - proposal doc shape expected (partial):
 *   { users: string[], votes: { [userId]: { [adminId]: true } }, approvedUsers: string[], requiredVotes: number, tokens: number, eventId: string }
 *
 * This function:
 *  - runs a transaction,
 *  - ensures the admin hasn't already voted for that user,
 *  - adds the vote,
 *  - if votes >= requiredVotes for that user, marks user approved (adds to approvedUsers)
 *    and transfers tokens to that user's doc (tokens increment + record achievement + rewardedEvents).
 */
// import { doc, runTransaction, increment, arrayUnion } from "firebase/firestore";
// import { db } from "@/firebaseConfig";

export async function voteOnProposalForUser(
  proposalId: string,
  targetUserId: string,
  adminId: string
) {
  const propRef = doc(db, "rewardProposals", proposalId);
  const userRef = doc(db, "users", targetUserId);

  return runTransaction(db, async (tx) => {
    // 1️⃣ READ EVERYTHING FIRST
    const propSnap = await tx.get(propRef);
    if (!propSnap.exists()) throw new Error("Proposal not found");

    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error("User not found");

    const prop: any = propSnap.data();
    const user: any = userSnap.data();

    const votes = prop.votes || {};
    const approvedUsers: string[] = prop.approvedUsers || [];
    const requiredVotes = prop.requiredVotes || 1;
    const tokens = prop.tokens || 0;
    const eventId = prop.eventId;

    // If already approved → stop
    if (approvedUsers.includes(targetUserId)) {
      return { status: "already-approved" };
    }

    const userVotes = votes[targetUserId] || {};

    // If admin already voted → stop
    if (userVotes[adminId]) {
      return { status: "already-voted" };
    }

    // Add this admin's vote
    const newVotesForUser = {
      ...userVotes,
      [adminId]: true
    };

    const newVoteCount = Object.keys(newVotesForUser).length;
    const willApprove = newVoteCount >= requiredVotes;

    // 2️⃣ NOW PREPARE UPDATES
    const proposalUpdates: any = {
      [`votes.${targetUserId}`]: newVotesForUser
    };

    if (willApprove) {
      proposalUpdates.approvedUsers = arrayUnion(targetUserId);
    }

    // 3️⃣ WRITE PROPOSAL
    tx.update(propRef, proposalUpdates);

    // 4️⃣ If approved → give tokens
    if (willApprove) {
      const rewardedEvents = user.rewardedEvents || [];

      if (!rewardedEvents.includes(eventId)) {
        tx.update(userRef, {
          tokens: increment(tokens),
          rewardedEvents: arrayUnion(eventId),
          achievements: arrayUnion({
            eventId,
            tokens,
            date: new Date().toISOString()
          })
        });
      }
    }

    return { status: "ok", approved: willApprove, votes: newVoteCount };
  });
}


/** Realtime events */
export function subscribeEvents(onUpdate: (events: DocumentData[]) => void) {
  const q = query(collection(db, "events"), orderBy("date", "asc"));
  return onSnapshot(q, (snap) => {
    const events = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    onUpdate(events);
  });
}

/** User doc */
export async function getUserDoc(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return { uid, ...(snap.data() as any) };
}






/* =====================================================
   SAFE EVENT REGISTRATION
===================================================== */

// import { runTransaction } from "firebase/firestore";

/** Register with capacity check */
export async function registerForEvent(eventId: string, userId: string) {
  const ref = doc(db, "events", eventId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Event not found");

    const data: any = snap.data();
    const participants = data.participants || [];
    const capacity = data.capacity || Infinity;

    if (participants.includes(userId)) return; // already registered
    if (participants.length >= capacity) throw new Error("Event full");

    tx.update(ref, {
      participants: [...participants, userId]
    });
  });
}

/** Unregister safely */
export async function unregisterFromEvent(eventId: string, userId: string) {
  const ref = doc(db, "events", eventId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const data: any = snap.data();
    const participants = data.participants || [];

    tx.update(ref, {
      participants: participants.filter((id: string) => id !== userId)
    });
  });
}






/* =====================================================
   STARRED EVENTS
===================================================== */

export async function addStar(eventId: string, userId: string) {
  await updateDoc(doc(db, "events", eventId), {
    starredBy: arrayUnion(userId)
  });
}

export async function removeStar(eventId: string, userId: string) {
  await updateDoc(doc(db, "events", eventId), {
    starredBy: arrayRemove(userId)
  });
}





/* =====================================================
   CREATE EVENT (SAFE)
===================================================== */

export async function createEventFirestore(eventData: any) {
  if (!eventData.name || !eventData.date) {
    throw new Error("Missing event name or date");
  }

  return addDoc(collection(db, "events"), {
    ...eventData,
    participants: [],
    rewardedUsers: [],
    starredBy: [],
    registered: 0,
    createdAt: serverTimestamp()
  });
}


/**
 * Issue a certificate to an approved student after proposal voting.
 *
 * This stores the certificate PURELY in Firestore — it works 100% reliably
 * without MetaMask, wallet authorization, or blockchain state.
 * The certificate is immediately visible on the student's Dashboard.
 *
 * Optional on-chain minting can be triggered later from the Issuer Dashboard.
 */
export async function issueCertificateForApprovedUser(
  uid: string,
  eventId: string,
  issuerName: string
): Promise<{ success: boolean; certificateId?: number; error?: string }> {
  try {
    // 1. Fetch student doc
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) throw new Error("Student user not found");
    const userData: any = userSnap.data();

    const studentName: string = userData.name || userData.email || uid;
    const studentEmail: string = userData.email || "";
    const walletAddress: string | null = userData.walletAddress || null;

    // 2. Fetch event name
    const eventSnap = await getDoc(doc(db, "events", eventId));
    const eventName: string = eventSnap.exists()
      ? (eventSnap.data() as any).name || eventId
      : eventId;

    // 3. Store certificate in Firestore — immediately visible in student Dashboard
    //    No blockchain call here — avoids MetaMask authorization errors entirely.
    const certRef = await addDoc(collection(db, "certificates"), {
      studentId: uid,
      studentEmail,
      studentName,
      walletAddress,
      certificateTitle: eventName,
      issuerName,
      eventId,
      certificateId: null,  // filled if later minted on-chain via Issuer Dashboard
      status: "issued",     // show as issued immediately
      issueDate: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });

    // 4. Also add to pendingCertificates queue so Issuer Dashboard can optionally mint NFT
    if (walletAddress) {
      await addDoc(collection(db, "pendingCertificates"), {
        firestoreCertId: certRef.id,
        studentId: uid,
        studentEmail,
        studentName,
        walletAddress,
        courseName: eventName,
        issuerName,
        eventId,
        status: "pending",
        createdAt: serverTimestamp(),
      });
    }

    console.log(`✅ Certificate issued to ${studentName} for ${eventName} (Firestore only)`);
    return { success: true };

  } catch (err: any) {
    console.error("issueCertificateForApprovedUser error:", err);
    return { success: false, error: err.message };
  }
}
