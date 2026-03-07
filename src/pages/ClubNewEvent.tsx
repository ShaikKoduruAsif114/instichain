// src/pages/ClubNewEvent.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const ALLOWED_ROLES = ["club", "head", "admin", "superhead"];

const ClubNewEvent = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [clubId, setClubId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    venue: "",
    date: "",
    startTime: "",
    endTime: "",
    capacity: "",
    tokens: "",
    certificateTitle: "",
    certificateDescription: ""
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        // not logged in => ask them to login
        navigate("/signin");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) {
          toast({ title: "Profile missing", description: "No user profile found. Contact admin.", variant: "destructive" });
          navigate("/dashboard");
          return;
        }

        const data = snap.data() as any;
        const roleRaw = (data.role ?? "").toString();
        const role = roleRaw.trim().toLowerCase();
        setUserRole(role);

        // allow multiple role names: club heads, admin etc
        if (!ALLOWED_ROLES.includes(role)) {
          toast({ title: "Not authorized", description: "Your account isn't allowed to create events.", variant: "destructive" });
          navigate("/dashboard");
          return;
        }

        // clubId can be stored in user doc; fallback to 'general'
        setClubId((data.clubId && data.clubId.toString()) || "general");
      } catch (err) {
        console.error("Error checking user:", err);
        toast({ title: "Error", description: "Failed to verify user. Try again.", variant: "destructive" });
        navigate("/dashboard");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [navigate, toast]);

  if (loading) return <div className="p-10">Loading...</div>;

  const updateField = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // basic validation
    if (!form.name || !form.date || !form.startTime || !form.endTime || !form.tokens || !form.certificateTitle) {
      toast({ title: "Missing fields", description: "Please fill Name, Date, Start/End time, Tokens, and Certificate Title.", variant: "destructive" });
      return;
    }

    const capacityNumber = form.capacity ? Number(form.capacity) : 0; // 0 = unlimited/unspecified
    const tokensNumber = Number(form.tokens);
    if (isNaN(tokensNumber) || tokensNumber <= 0) {
      toast({ title: "Invalid tokens", description: "Enter a valid positive number for tokens.", variant: "destructive" });
      return;
    }

    try {
      await addDoc(collection(db, "events"), {
        name: form.name,
        description: form.description || "",
        venue: form.venue || "",
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        capacity: Number(form.capacity || 0),
        tokens: Number(form.tokens),
        certificateTitle: form.certificateTitle.trim(),
        certificateDescription: form.certificateDescription.trim(),
        clubId,
        participants: [],
        starredBy: [],
        status: "upcoming",
        createdAt: serverTimestamp()
      });


      toast({ title: "Event created", description: `"${form.name}" created successfully` });
      navigate("/club");
    } catch (err) {
      console.error("Create event failed:", err);
      toast({ title: "Error", description: "Failed to create event. Try again.", variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Create New Event</h1>
          <p className="text-muted-foreground">Set up a new event for students to participate in and earn tokens</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Input placeholder="Event name *" required value={form.name} onChange={e => updateField("name", e.target.value)} />
          <Textarea placeholder="Description" value={form.description} onChange={e => updateField("description", e.target.value)} />

          {/* Venue free text */}
          <Input placeholder="Venue (any location)" value={form.venue} onChange={e => updateField("venue", e.target.value)} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input type="date" required value={form.date} onChange={e => updateField("date", e.target.value)} />
            <Input type="time" required value={form.startTime} onChange={e => updateField("startTime", e.target.value)} />
            <Input type="time" required value={form.endTime} onChange={e => updateField("endTime", e.target.value)} />
          </div>

          {/* Capacity optional, allow large numbers / zero for unlimited */}
          <Input placeholder="Capacity (optional, leave empty for unlimited)" type="number" min={0} value={form.capacity} onChange={e => updateField("capacity", e.target.value)} />

          <Input placeholder="Tokens per participant *" type="number" min={1} required value={form.tokens} onChange={e => updateField("tokens", e.target.value)} />

          {/* Certificate Template */}
          <div className="space-y-2 pt-2 border-t">
            <p className="text-sm font-semibold">Certificate Template</p>
            <Input
              placeholder="Certificate Title * (e.g. Best Presenter Award)"
              required
              value={form.certificateTitle}
              onChange={e => updateField("certificateTitle", e.target.value)}
            />
            <Textarea
              placeholder="Certificate Description (e.g. Awarded for outstanding performance at...)"
              value={form.certificateDescription}
              onChange={e => updateField("certificateDescription", e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => navigate("/club")}>Cancel</Button>
            <Button type="submit">Create Event</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClubNewEvent;
