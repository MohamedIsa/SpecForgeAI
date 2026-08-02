export const shorthands = undefined;

export const up = (pgm) => {
  pgm.addConstraint("project_statuses", "project_statuses_project_name_unique", {
    unique: ["project_id", "name"],
  });
};

export const down = (pgm) => {
  pgm.dropConstraint("project_statuses", "project_statuses_project_name_unique");
};
