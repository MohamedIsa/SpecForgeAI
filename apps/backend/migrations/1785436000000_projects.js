export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("projects", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "text", notNull: true },
    key: { type: "text", notNull: true },
    description: { type: "text", notNull: false },
    template: { type: "text", notNull: true },
    next_ticket_number: { type: "integer", notNull: true, default: 101 },
    owner_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("projects", "projects_key_unique", { unique: "key" });
  pgm.addConstraint("projects", "projects_template_check", {
    check: "template IN ('kanban', 'scrum')",
  });

  pgm.createTable("project_statuses", {
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
    name: { type: "text", notNull: true },
    position: { type: "integer", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("project_memberships", {
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
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    role: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("project_memberships", "project_memberships_project_user_unique", {
    unique: ["project_id", "user_id"],
  });
  pgm.addConstraint("project_memberships", "project_memberships_role_check", {
    check: "role IN ('owner', 'editor', 'viewer')",
  });
};

export const down = (pgm) => {
  pgm.dropTable("project_memberships");
  pgm.dropTable("project_statuses");
  pgm.dropTable("projects");
};
