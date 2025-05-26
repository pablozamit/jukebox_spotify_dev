// src/lib/firebaseAdmin.ts
console.warn(
  "Firebase Admin SDK (src/lib/firebaseAdmin.ts) has been effectively disabled as part of the Electron migration."
);
console.warn(
  "If any Next.js API routes still attempt to use 'adminDb', they will receive 'null' and likely fail."
);
console.warn(
  "These API routes should be refactored or deprecated."
);

// Export null to minimize runtime errors in files that still import adminDb.
// Those files should eventually be updated to not rely on this.
export const adminDb = null;

// Optionally, to make it even clearer if something tries to use admin:
// export const admin = {
//   initializeApp: () => console.warn("Firebase Admin app.initializeApp called on disabled module"),
//   credential: { cert: () => console.warn("Firebase Admin app.credential.cert called on disabled module")},
//   apps: [],
//   database: () => {
//     console.warn("Firebase Admin admin.database() called on disabled module");
//     return null;
//   }
// };
// However, just exporting adminDb = null is simpler and achieves the immediate goal.
