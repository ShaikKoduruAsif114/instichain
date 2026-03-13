/**
 * src/lib/pdfGenerator.ts
 *
 * Utility to generate a visually styled certificate PDF using jsPDF.
 * No external canvas rendering needed — all drawn via jsPDF vector graphics.
 */

import jsPDF from "jspdf";

export interface CertificateDetails {
    studentName: string;
    courseName: string;
    issuerName: string;
    eventName?: string;
    date?: string; // ISO string or human-readable
}

/**
 * Generate a sample certificate PDF as a File object (ready to upload to IPFS).
 */
export async function generateSampleCertificatePDF(
    details: CertificateDetails
): Promise<File> {
    const { studentName, courseName, issuerName, eventName, date } = details;

    const displayDate = date
        ? new Date(date).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
        })
        : new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });

    const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
    });

    const W = 297;
    const H = 210;

    // ── Background ──────────────────────────────────────────────────────────────
    doc.setFillColor(10, 14, 39); // deep navy
    doc.rect(0, 0, W, H, "F");

    // ── Outer gold border ────────────────────────────────────────────────────────
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(1.5);
    doc.rect(8, 8, W - 16, H - 16);

    doc.setLineWidth(0.5);
    doc.rect(11, 11, W - 22, H - 22);

    // ── Corner ornaments (tiny gold squares) ────────────────────────────────────
    const corners = [
        [8, 8],
        [W - 13, 8],
        [8, H - 13],
        [W - 13, H - 13],
    ];
    doc.setFillColor(212, 175, 55);
    for (const [cx, cy] of corners) {
        doc.rect(cx, cy, 5, 5, "F");
    }

    // ── Decorative header band ───────────────────────────────────────────────────
    doc.setFillColor(212, 175, 55, 0.15);
    doc.setFillColor(30, 40, 80);
    doc.rect(11, 11, W - 22, 28, "F");

    // ── Institution name ─────────────────────────────────────────────────────────
    doc.setTextColor(212, 175, 55);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(issuerName.toUpperCase(), W / 2, 22, { align: "center" });

    // ── "Certificate of Achievement" subtitle ───────────────────────────────────
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(180, 190, 220);
    doc.text("CERTIFICATE OF ACHIEVEMENT", W / 2, 30, { align: "center" });

    // ── Divider line ─────────────────────────────────────────────────────────────
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.4);
    doc.line(40, 44, W - 40, 44);

    // ── "THIS IS TO CERTIFY THAT" ────────────────────────────────────────────────
    doc.setTextColor(160, 175, 210);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("THIS IS TO CERTIFY THAT", W / 2, 56, { align: "center" });

    // ── Student Name ─────────────────────────────────────────────────────────────
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(30);
    doc.setFont("helvetica", "bold");
    doc.text(studentName, W / 2, 76, { align: "center" });

    // ── Name underline ───────────────────────────────────────────────────────────
    const nameWidth = doc.getTextWidth(studentName);
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.5);
    doc.line(W / 2 - nameWidth / 2, 79, W / 2 + nameWidth / 2, 79);

    // ── "has successfully completed" ─────────────────────────────────────────────
    doc.setTextColor(160, 175, 210);
    doc.setFontSize(10);
    doc.setFont("helvetica", "italic");
    doc.text("has successfully completed", W / 2, 90, { align: "center" });

    // ── Course / Award name ───────────────────────────────────────────────────────
    doc.setTextColor(212, 175, 55);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(courseName, W / 2, 105, { align: "center" });

    // ── Event name (if any) ───────────────────────────────────────────────────────
    if (eventName) {
        doc.setTextColor(180, 190, 220);
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`awarded at ${eventName}`, W / 2, 116, { align: "center" });
    }

    // ── Bottom divider ────────────────────────────────────────────────────────────
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.4);
    doc.line(40, 140, W - 40, 140);

    // ── Date (left) ───────────────────────────────────────────────────────────────
    doc.setTextColor(160, 175, 210);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("DATE OF ISSUE", 70, 152, { align: "center" });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(displayDate, 70, 159, { align: "center" });

    // ── Signature line (center) ───────────────────────────────────────────────────
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.4);
    doc.line(W / 2 - 30, 158, W / 2 + 30, 158);
    doc.setTextColor(160, 175, 210);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("AUTHORISED SIGNATURE", W / 2, 163, { align: "center" });

    // ── Blockchain verified stamp (right) ─────────────────────────────────────────
    doc.setTextColor(160, 175, 210);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text("BLOCKCHAIN VERIFIED", W - 70, 152, { align: "center" });
    doc.setTextColor(80, 220, 120);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("✓ InstitiChain", W - 70, 159, { align: "center" });

    // ── Footer watermark ──────────────────────────────────────────────────────────
    doc.setTextColor(60, 72, 110);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(
        "This certificate is issued on and verified by the InstitiChain blockchain. Tampering is impossible.",
        W / 2,
        H - 14,
        { align: "center" }
    );

    // ── Output as File ────────────────────────────────────────────────────────────
    const pdfBytes = doc.output("arraybuffer");
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const safeStudentName = studentName.replace(/\s+/g, "_");
    const file = new File([blob], `certificate_${safeStudentName}.pdf`, {
        type: "application/pdf",
    });

    return file;
}
