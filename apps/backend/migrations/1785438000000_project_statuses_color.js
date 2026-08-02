export const shorthands = undefined;

const DEFAULT_COLOR = "#71717a";

export const up = (pgm) => {
  pgm.addColumn("project_statuses", {
    color: { type: "text", notNull: true, default: DEFAULT_COLOR },
  });
  pgm.addConstraint("project_statuses", "project_statuses_color_check", {
    check: "color ~ '^#[0-9A-Fa-f]{6}$'",
  });
};

export const down = (pgm) => {
  pgm.dropColumn("project_statuses", "color");
};
