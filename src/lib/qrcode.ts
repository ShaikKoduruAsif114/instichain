/**
 * src/lib/qrcode.ts
 * 
 * QR code generation utilities for certificate verification
 * Uses qrcode library for generating QR codes
 * 
 * Install: npm install qrcode
 */

/**
 * Generate QR code as data URL
 * @param text Text or URL to encode in QR code
 * @returns Data URL for the QR code image
 */
export async function generateQRCode(text: string): Promise<string> {
  try {
    // Dynamically import to avoid build issues
    let QRCode: any;
    try {
      // @ts-ignore - qrcode is an optional dependency
      const module = await import("qrcode");
      QRCode = module.default;
    } catch (e) {
      throw new Error(
        "qrcode module not found. Install with: npm install qrcode"
      );
    }
    
    const qrCode = await QRCode.toDataURL(text, {
      errorCorrectionLevel: "H",
      type: "image/png",
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    return qrCode;
  } catch (error: any) {
    throw new Error(`QR code generation failed: ${error.message}`);
  }
}

/**
 * Generate verification link for a certificate
 * @param certificateId ID of the certificate
 * @param baseUrl Base URL of the app (e.g., https://example.com)
 * @returns Full verification URL
 */
export function generateVerificationLink(
  certificateId: number,
  baseUrl: string = window.location.origin
): string {
  return `${baseUrl}/verify/${certificateId}`;
}

/**
 * Generate QR code for certificate verification
 * @param certificateId ID of the certificate
 * @returns QR code data URL
 */
export async function generateCertificateQRCode(certificateId: number): Promise<string> {
  const verificationLink = generateVerificationLink(certificateId);
  return generateQRCode(verificationLink);
}

/**
 * Download QR code as PNG file
 * @param qrDataUrl QR code data URL
 * @param fileName Name for the downloaded file
 */
export function downloadQRCode(qrDataUrl: string, fileName: string = "certificate-qr.png") {
  const link = document.createElement("a");
  link.href = qrDataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Copy QR code to clipboard
 * @param qrDataUrl QR code data URL
 */
export async function copyQRCodeToClipboard(qrDataUrl: string) {
  try {
    const blob = await fetch(qrDataUrl).then((res) => res.blob());
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    console.log("✅ QR code copied to clipboard");
  } catch (error) {
    console.error("Failed to copy QR code:", error);
    throw new Error("Failed to copy QR code to clipboard");
  }
}

/**
 * Parse certificate ID from verification URL
 * @param url URL like /verify/123
 * @returns Certificate ID or null
 */
export function parseCertificateIdFromUrl(url: string): number | null {
  const match = url.match(/\/verify\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
