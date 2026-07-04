exports.up = (pgm) => {
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.createTable("epics", {
    id: { type: "varchar", primaryKey: true },
    title: { type: "text", notNull: true },
    description: { type: "text" },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("tickets", {
    id: { type: "varchar", primaryKey: true },
    epic_id: {
      type: "varchar",
      notNull: true,
      references: "epics(id)",
      onDelete: "CASCADE",
    },
    title: { type: "text", notNull: true },
    type: { type: "text", notNull: true },
    priority: { type: "text", notNull: true },
    story_points: { type: "integer", notNull: true },
    status: { type: "text", notNull: true, default: "backlog" },
    dependencies: { type: "jsonb", default: "[]" },
    description: { type: "text" },
    acceptance_criteria: { type: "jsonb", default: "[]" },
    ai_dev_prompt: { type: "text" },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("tickets", "tickets_type_check", {
    check: "type IN ('setup', 'feature', 'infra', 'integration', 'testing', 'bugfix')",
  });

  pgm.addConstraint("tickets", "tickets_priority_check", {
    check: "priority IN ('P0', 'P1', 'P2', 'P3')",
  });

  pgm.addConstraint("tickets", "tickets_story_points_check", {
    check: "story_points IN (1, 2, 3, 5, 8)",
  });

  pgm.addConstraint("tickets", "tickets_status_check", {
    check: "status IN ('backlog', 'todo', 'in_progress', 'review', 'done')",
  });

  pgm.createIndex("tickets", "epic_id");
  pgm.createIndex("tickets", "status");
  pgm.createIndex("tickets", "type");

  pgm.createTable("brd_uploads", {
    id: { type: "varchar", primaryKey: true },
    file_name: { type: "text", notNull: true },
    file_path: { type: "text" },
    status: {
      type: "text",
      notNull: true,
      default: "pending",
    },
    validation_report: { type: "jsonb" },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("brd_uploads", "brd_uploads_status_check", {
    check: "status IN ('pending', 'processing', 'completed', 'failed')",
  });

  pgm.createTable("tech_stacks", {
    id: { type: "varchar", primaryKey: true },
    name: { type: "text", notNull: true, unique: true },
    display_name: { type: "text", notNull: true },
    description: { type: "text" },
    stack_config: { type: "jsonb", default: "{}" },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("tickets", { ifExists: true });
  pgm.dropTable("epics", { ifExists: true });
  pgm.dropTable("brd_uploads", { ifExists: true });
  pgm.dropTable("tech_stacks", { ifExists: true });
};
