export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("tickets", {
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
    status_id: {
      type: "uuid",
      notNull: true,
      references: "project_statuses",
      onDelete: "RESTRICT",
    },
    key: { type: "text", notNull: true },
    title: { type: "text", notNull: true },
    description: { type: "text", notNull: false },
    type: { type: "text", notNull: true },
    priority: { type: "text", notNull: true },
    story_points: { type: "integer", notNull: false },
    assignee_id: {
      type: "uuid",
      notNull: false,
      references: "users",
      onDelete: "SET NULL",
    },
    acceptance_criteria: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
    ai_dev_prompt: { type: "text", notNull: false },
    dependencies: { type: "uuid[]", notNull: true, default: pgm.func("'{}'::uuid[]") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("tickets", "tickets_project_key_unique", { unique: ["project_id", "key"] });
  pgm.addConstraint("tickets", "tickets_type_check", {
    check: "type IN ('story', 'bug', 'task')",
  });
  pgm.addConstraint("tickets", "tickets_priority_check", {
    check: "priority IN ('P0', 'P1', 'P2', 'P3')",
  });
  pgm.addConstraint("tickets", "tickets_story_points_check", {
    check: "story_points IS NULL OR story_points >= 0",
  });

  pgm.createIndex("tickets", "project_id");
  pgm.createIndex("tickets", "status_id");
};

export const down = (pgm) => {
  pgm.dropTable("tickets");
};
