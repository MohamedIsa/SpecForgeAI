export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("epics", {
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
    title: { type: "text", notNull: true },
    position: { type: "integer", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("epics", "project_id");

  pgm.addColumn("tickets", {
    epic_id: {
      type: "uuid",
      notNull: false,
      references: "epics",
      onDelete: "SET NULL",
    },
  });

  pgm.createIndex("tickets", "epic_id");
};

export const down = (pgm) => {
  pgm.dropColumn("tickets", "epic_id");
  pgm.dropTable("epics");
};
