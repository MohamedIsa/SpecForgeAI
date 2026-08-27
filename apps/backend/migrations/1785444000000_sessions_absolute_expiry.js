export const shorthands = undefined;

// SEC-T4: sessions were rotated on every refresh with expires_at reset to a
// fresh `now() + 30d`, uncapped — a refresh token, if never noticed stolen,
// could keep a session alive forever, 30 days at a time. absolute_expires_at
// is a ceiling fixed at the ORIGINAL login and carried forward unchanged
// through every rotation; the app never lets a rotated session's expires_at
// exceed it, so a session can be refreshed indefinitely but never outlive
// 30 days from when the user actually authenticated.
export const up = (pgm) => {
  pgm.addColumn("sessions", {
    absolute_expires_at: { type: "timestamptz", notNull: false },
  });
  // Backfill: pre-migration sessions never tracked an original-login ceiling,
  // so grandfather them in with their current rolling expiry as the ceiling
  // — conservative (no extra lifetime granted) rather than guessing back to
  // created_at + 30d, which could be later than what a real 30d cap allows.
  pgm.sql(
    "UPDATE sessions SET absolute_expires_at = expires_at WHERE absolute_expires_at IS NULL",
  );
  pgm.alterColumn("sessions", "absolute_expires_at", { notNull: true });
};

export const down = (pgm) => {
  pgm.dropColumn("sessions", "absolute_expires_at");
};
