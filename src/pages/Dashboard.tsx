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

import {
  Calendar,
  LayoutDashboard,
  Award,
  FileText,
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
  const [events, setEvents] = useState<EventItem[]>([]);
  const [registeredEvents, setRegisteredEvents] = useState<EventItem[]>([]);
  const [attendedEvents, setAttendedEvents] = useState<EventItem[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<EventItem[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);

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

        // Load certificates earned by this user
        // Use userObj directly (not currentUser state — that hasn't updated yet)
        const certsCol = collection(db, "certificates");
        const certsQuery = await getDocs(
          query(certsCol, where("studentEmail", "==", userObj.email))
        );
        const userCerts = certsQuery.docs.map((d: QueryDocumentSnapshot<DocumentData>) => ({
          id: d.id,
          ...d.data(),
        }));
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
                  <Badge variant={cert.status === "issued" ? "default" : "secondary"}>
                    {cert.status}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

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
    </div>
  );
};

export default Dashboard;
