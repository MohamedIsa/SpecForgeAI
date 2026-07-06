exports.up = (pgm) => {
  pgm.addColumns("epics", {
    brd_upload_id: {
      type: "varchar",
      references: "brd_uploads(id)",
      onDelete: "CASCADE",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("epics", ["brd_upload_id"]);
};
