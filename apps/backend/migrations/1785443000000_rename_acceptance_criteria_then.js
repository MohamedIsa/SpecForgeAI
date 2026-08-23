export const shorthands = undefined;

// SonarCloud typescript:S7739 ("Do not add `then` to an object") flagged the
// acceptance-criterion shape across the app. The app-level rename to
// `expectedResult` is worthless on its own: `tickets.acceptance_criteria` is
// jsonb, so every already-published ticket still has a literal `then` key on
// disk and would fail `isAcceptanceCriteria` validation the moment it's read
// back through the renamed field. This migration rewrites existing rows to
// match; `down` reverses it symmetrically.

export const up = (pgm) => {
  pgm.sql(`
    UPDATE tickets
    SET acceptance_criteria = COALESCE(
      (
        SELECT jsonb_agg((elem - 'then') || jsonb_build_object('expectedResult', elem -> 'then'))
        FROM jsonb_array_elements(acceptance_criteria) AS elem
      ),
      '[]'::jsonb
    )
    WHERE jsonb_array_length(acceptance_criteria) > 0
      AND acceptance_criteria @> '[{}]'::jsonb
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(acceptance_criteria) AS elem
        WHERE elem ? 'then'
      );
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    UPDATE tickets
    SET acceptance_criteria = COALESCE(
      (
        SELECT jsonb_agg((elem - 'expectedResult') || jsonb_build_object('then', elem -> 'expectedResult'))
        FROM jsonb_array_elements(acceptance_criteria) AS elem
      ),
      '[]'::jsonb
    )
    WHERE jsonb_array_length(acceptance_criteria) > 0
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(acceptance_criteria) AS elem
        WHERE elem ? 'expectedResult'
      );
  `);
};
