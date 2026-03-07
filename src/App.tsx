import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

// ✅ FIXED IMPORT (capital C)
import ComplaintsPage from "@/pages/Complaints";

// Pages
import Index from "./pages/Index";
import SignIn from "./pages/SignIn";
import Profile from "./pages/Profile";
import Events from "./pages/Events";
import Dashboard from "./pages/Dashboard";
import ClubDashboard from "./pages/ClubDashboard";
import ClubNewEvent from "./pages/ClubNewEvent";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Help from "./pages/Help";
import NotFound from "./pages/NotFound";
import HeadDashboard from "./pages/HeadDashboard";
import ClubProposals from "./pages/ClubProposals";

// =================== BLOCKCHAIN CERTIFICATE PAGES ===================
import IssuerDashboard from "./pages/IssuerDashboard";
import HeadIssuerDashboard from "./pages/HeadIssuerDashboard";
import CertificatePortal from "./pages/CertificatePortal";
import VerifyCertificate from "./pages/VerifyCertificate";

// Layout
import Layout from "./components/Layout";
import ProtectedRoute from "./components/protectedroute";

const queryClient = new QueryClient();

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Layout>
            <Routes>
              {/* Public */}
              <Route path="/" element={<Index />} />
              <Route path="/signin" element={<SignIn />} />
              <Route path="/events" element={<Events />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/help" element={<Help />} />

              {/* Logged-in users */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />

              {/* Club admins */}
              <Route
                path="/club"
                element={
                  <ProtectedRoute>
                    <ClubDashboard />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/club/new-event"
                element={
                  <ProtectedRoute>
                    <ClubNewEvent />
                  </ProtectedRoute>
                }
              />

              <Route
                path="/club/proposals"
                element={
                  <ProtectedRoute>
                    <ClubProposals />
                  </ProtectedRoute>
                }
              />

              {/* ✅ FIXED: Complaints route */}
              <Route
                path="/club/complaints"
                element={
                  <ProtectedRoute>
                    <ComplaintsPage />
                  </ProtectedRoute>
                }
              />

              {/* Head */}
              <Route
                path="/head"
                element={
                  <ProtectedRoute>
                    <HeadDashboard />
                  </ProtectedRoute>
                }
              />

              {/* =================== BLOCKCHAIN CERTIFICATE ROUTES =================== */}

              {/* Issuer Dashboard - Issue certificates */}
              <Route
                path="/issuer"
                element={
                  <ProtectedRoute>
                    <IssuerDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Student Certificate Portal - View certificates */}
              <Route
                path="/certificates"
                element={
                  <ProtectedRoute>
                    <CertificatePortal />
                  </ProtectedRoute>
                }
              />

              {/* Public Verification - Verify any certificate (no login required) */}
              <Route path="/verify" element={<VerifyCertificate />} />
              <Route path="/verify/:certificateId" element={<VerifyCertificate />} />

              {/* 404 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
