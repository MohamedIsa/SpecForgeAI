exports.up = (pgm) => {
  pgm.addColumns("brd_uploads", {
    updated_at: {
      type: "timestamp",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("brd_uploads", ["updated_at"]);
};
