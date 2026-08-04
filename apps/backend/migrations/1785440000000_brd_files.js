export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable("brd_files", {
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
    file_name: { type: "text", notNull: true },
    extension: { type: "text", notNull: true },
    byte_size: { type: "bigint", notNull: true },
    checksum: { type: "text", notNull: true },
    storage_path: { type: "text", notNull: true },
    scan_status: { type: "text", notNull: true },
    scan_signature: { type: "text", notNull: false },
    uploaded_by: {
      type: "uuid",
      notNull: false,
      references: "users",
      onDelete: "SET NULL",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("brd_files", "brd_files_extension_check", {
    check: "extension IN ('pdf', 'docx', 'md')",
  });
  // Only clean files are ever persisted; the column exists so the stored row
  // records *why* it was kept, and leaves room for future quarantine states.
  pgm.addConstraint("brd_files", "brd_files_scan_status_check", {
    check: "scan_status IN ('clean')",
  });
  pgm.addConstraint("brd_files", "brd_files_byte_size_check", {
    check: "byte_size > 0",
  });
  pgm.addConstraint("brd_files", "brd_files_storage_path_unique", {
    unique: "storage_path",
  });

  pgm.createIndex("brd_files", "project_id");

  pgm.createTable("project_tech_preferences", {
    project_id: {
      type: "uuid",
      primaryKey: true,
      references: "projects",
      onDelete: "CASCADE",
    },
    frontend: { type: "text", notNull: false },
    backend: { type: "text", notNull: false },
    database: { type: "text", notNull: false },
    infra: { type: "text", notNull: false },
    updated_by: {
      type: "uuid",
      notNull: false,
      references: "users",
      onDelete: "SET NULL",
    },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

export const down = (pgm) => {
  pgm.dropTable("project_tech_preferences");
  pgm.dropTable("brd_files");
};
