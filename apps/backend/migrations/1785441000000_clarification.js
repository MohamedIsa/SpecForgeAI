export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("clarification_sessions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    project_id: {
      type: "uuid",
      notNull: true,
      references: "projects",
      onDelete: "CASCADE",
    },
    status: { type: "text", notNull: true, default: "active" },
    compiled_context: { type: "text", notNull: false },
    created_by: {
      type: "uuid",
      notNull: false,
      references: "users",
      onDelete: "SET NULL",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    completed_at: { type: "timestamptz", notNull: false },
  });

  pgm.addConstraint("clarification_sessions", "clarification_sessions_status_check", {
    check: "status IN ('active', 'completed')",
  });
  // A completed session must carry the compiled specification context it produced.
  pgm.addConstraint("clarification_sessions", "clarification_sessions_completed_check", {
    check:
      "(status = 'active' AND completed_at IS NULL) OR (status = 'completed' AND completed_at IS NOT NULL AND compiled_context IS NOT NULL)",
  });
  // At most one active session per project: this is what makes concurrent
  // startSession calls collide at the DB rather than silently forking state.
  pgm.createIndex("clarification_sessions", "project_id", {
    unique: true,
    where: "status = 'active'",
    name: "clarification_sessions_one_active_per_project",
  });

  pgm.createTable("clarification_questions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    session_id: {
      type: "uuid",
      notNull: true,
      references: "clarification_sessions",
      onDelete: "CASCADE",
    },
    position: { type: "integer", notNull: true },
    prompt: { type: "text", notNull: true },
    ambiguity: { type: "text", notNull: true },
    quick_replies: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    answer: { type: "text", notNull: false },
    resolved_at: { type: "timestamptz", notNull: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("clarification_questions", "clarification_questions_position_unique", {
    unique: ["session_id", "position"],
  });
  // A resolved question must record the answer that resolved it.
  pgm.addConstraint("clarification_questions", "clarification_questions_resolved_check", {
    check: "(resolved_at IS NULL) OR (resolved_at IS NOT NULL AND answer IS NOT NULL)",
  });
  pgm.createIndex("clarification_questions", "session_id");

  pgm.createTable("clarification_messages", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    session_id: {
      type: "uuid",
      notNull: true,
      references: "clarification_sessions",
      onDelete: "CASCADE",
    },
    question_id: {
      type: "uuid",
      notNull: false,
      references: "clarification_questions",
      onDelete: "CASCADE",
    },
    // A user answer and the AI's follow-up are written inside one transaction,
    // so they share now(). `seq` is what gives the chat a stable, monotonic
    // order; created_at alone would leave the bubbles interleaving randomly.
    seq: { type: "bigserial", notNull: true },
    role: { type: "text", notNull: true },
    content: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("clarification_messages", "clarification_messages_role_check", {
    check: "role IN ('ai', 'user')",
  });
  pgm.createIndex("clarification_messages", ["session_id", "seq"]);
};

export const down = (pgm) => {
  pgm.dropTable("clarification_messages");
  pgm.dropTable("clarification_questions");
  pgm.dropTable("clarification_sessions");
};
