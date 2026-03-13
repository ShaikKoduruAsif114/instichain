// src/pages/SignIn.tsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signOut,
  User,
} from "firebase/auth";
import {
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import { auth, db } from "../firebaseConfig";

const COLLEGE_DOMAIN = "@smail.iitm.ac.in";

const SignIn: React.FC = () => {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const navigate = useNavigate();
  const redirectedRef = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user: User | null) => {
      if (user && !user.emailVerified) {
        setInfo(
          "Please verify your email address. Check your inbox for the verification link."
        );
      } else {
        setInfo(null);
      }
    });
    return () => unsub();
  }, []);

  const showError = (e: unknown) => {
    console.error(e);
    alert(
      typeof e === "object" && e && "message" in e
        ? (e as any).message
        : String(e)
    );
  };

  /* ================= REGISTER ================= */
  const handleRegister = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      alert("Name is required for registration.");
      return;
    }

    if (!trimmedEmail || !pw) {
      alert("Please enter name, college email and password.");
      return;
    }

    if (!trimmedEmail.endsWith(COLLEGE_DOMAIN)) {
      alert(`Please use your institute email (${COLLEGE_DOMAIN}).`);
      return;
    }

    setLoading(true);
    setInfo(null);

    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        trimmedEmail,
        pw
      );

      // Firestore user profile (name is guaranteed non-empty here)
      await setDoc(doc(db, "users", cred.user.uid), {
        name: trimmedName,
        email: trimmedEmail,
        role: role,
        walletAddress: null,
        createdAt: serverTimestamp(),
      });

      await sendEmailVerification(cred.user);
      await signOut(auth);

      setInfo(
        "Registration successful. Verification email sent. Please verify and then log in."
      );

      // clear form
      setName("");
      setEmail("");
      setPw("");
    } catch (e) {
      showError(e);
    } finally {
      setLoading(false);
    }
  };

  /* ================= LOGIN ================= */
  const handleLogin = async () => {
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !pw) {
      alert("Please enter email and password.");
      return;
    }

    setLoading(true);
    setInfo(null);

    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        trimmedEmail,
        pw
      );

      if (!cred.user.emailVerified) {
        await signOut(auth);
        setInfo("Email not verified. Please verify before logging in.");
        return;
      }

      const userSnap = await getDoc(doc(db, "users", cred.user.uid));
      if (!userSnap.exists()) {
        alert("User profile not found.");
        await signOut(auth);
        return;
      }

      const userRole = userSnap.data()?.role || "student";

      if (!redirectedRef.current) {
        redirectedRef.current = true;
        if (userRole === "head") {
          navigate("/head", { replace: true });
        } else if (userRole === "club") {
          navigate("/club", { replace: true });
        } else if (userRole === "recruiter") {
          navigate("/verify", { replace: true });
        } else {
          navigate("/dashboard", { replace: true });
        }
      }
    } catch (e) {
      showError(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleSelection = (selectedRole: string) => {
    if (selectedRole === "recruiter") {
      navigate("/verify");
    } else {
      setRole(selectedRole);
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-8 p-8">
      <h1 className="text-4xl font-bold text-center mb-2">
        Credential Management System
      </h1>
      <p className="text-center text-gray-600 mb-8">
        Choose your role to sign in
      </p>

      {info && (
        <div className="mb-4 p-3 bg-yellow-50 border-l-4 border-yellow-400 text-sm max-w-md mx-auto">
          {info}
        </div>
      )}

      {/* Role Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Insti Zone Card */}
        <div
          onClick={() => handleRoleSelection("student")}
          className={`p-6 border-2 rounded-lg cursor-pointer transition ${role === "student"
            ? "border-blue-600 bg-blue-50"
            : "border-gray-200 hover:border-blue-300"
            }`}
        >
          <h3 className="text-lg font-semibold mb-2">🎓 Insti Zone</h3>
          <p className="text-sm text-gray-600">
            For Students to manage certificates and events, and for Heads to manage clubs.
          </p>
        </div>

        {/* Recruiter Card */}
        <div
          onClick={() => handleRoleSelection("recruiter")}
          className={`p-6 border-2 rounded-lg cursor-pointer transition ${role === "recruiter"
            ? "border-purple-600 bg-purple-50"
            : "border-gray-200 hover:border-purple-300"
            }`}
        >
          <h3 className="text-lg font-semibold mb-2">🔍 Recruiter Zone</h3>
          <p className="text-sm text-gray-600">
            Verify the authenticity of certificates and credentials (No login required)
          </p>
        </div>
      </div>

      {/* Form Section - Conditionally Rendered */}
      {role && role !== "recruiter" && (
        <div className="max-w-md mx-auto border rounded-lg p-6 shadow-sm">
          <h2 className="text-2xl font-semibold mb-4">Sign in / Register (Insti Zone)</h2>

          <label className="block mb-3">
            <div className="text-sm font-medium text-gray-700">
              Full name <span className="text-red-500">*</span>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 p-2 border rounded"
              placeholder="Your full name"
            />
          </label>

          <label className="block mb-3">
            <div className="text-sm font-medium text-gray-700">Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`you${COLLEGE_DOMAIN}`}
              className="w-full mt-1 p-2 border rounded"
            />
          </label>

          <label className="block mb-4">
            <div className="text-sm font-medium text-gray-700">Password</div>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full mt-1 p-2 border rounded"
            />
          </label>

          <div className="flex gap-3">
            <button
              onClick={handleLogin}
              disabled={loading}
              className="flex-1 px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? "Loading..." : "Login"}
            </button>

            <button
              onClick={handleRegister}
              disabled={loading}
              className="flex-1 px-4 py-2 rounded border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {loading ? "Loading..." : "Register"}
            </button>
          </div>

          <p className="mt-4 text-sm text-gray-500 text-center">
            Use your institute email ending with{" "}
            <strong>{COLLEGE_DOMAIN}</strong>.
          </p>
        </div>
      )}
    </div>
  );
};

export default SignIn;
