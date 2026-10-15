"use client";

import dynamic from "next/dynamic";

/**
 * The certificate form, fetched when someone opens it, so Today and Map don't ship it on first load (phone budget,
 * engineering-standards.md section 5). `preloadCertificateForm` starts the fetch when the opener is pointed at or
 * focused, so it is usually there by the time it is pressed.
 */
export const LazyCertificateForm = dynamic(() => import("./certificate-form").then((m) => m.CertificateForm));

export const preloadCertificateForm = () => {
  void import("./certificate-form");
};
