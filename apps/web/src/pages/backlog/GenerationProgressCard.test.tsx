import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { GenerationProgressCard, GENERATION_STEPS } from "./GenerationProgressCard";

describe("GenerationProgressCard", () => {
  it("renders the first step's label and spinner when generation starts", () => {
    render(<GenerationProgressCard activeStepIndex={0} />);
    expect(screen.getByTestId("generation-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("active-step-label")).toHaveTextContent(GENERATION_STEPS[0]);
  });

  it("advances the active step label as activeStepIndex increases", () => {
    const { rerender } = render(<GenerationProgressCard activeStepIndex={0} />);
    expect(screen.getByTestId("active-step-label")).toHaveTextContent(GENERATION_STEPS[0]);

    rerender(<GenerationProgressCard activeStepIndex={2} />);
    expect(screen.getByTestId("active-step-label")).toHaveTextContent(GENERATION_STEPS[2]);
  });

  it("renders every step in the checklist", () => {
    render(<GenerationProgressCard activeStepIndex={1} />);
    const steps = screen.getAllByTestId("generation-step");
    expect(steps).toHaveLength(GENERATION_STEPS.length);
    for (const step of GENERATION_STEPS) {
      expect(within(screen.getByRole("list")).getByText(step)).toBeInTheDocument();
    }
  });

  it("marks steps before the active one as done with a checkmark", () => {
    render(<GenerationProgressCard activeStepIndex={2} />);
    expect(screen.getAllByLabelText("Done")).toHaveLength(2);
  });

  it("shows no checkmarks on the first step", () => {
    render(<GenerationProgressCard activeStepIndex={0} />);
    expect(screen.queryByLabelText("Done")).not.toBeInTheDocument();
  });

  it("reflects progress in the progress bar's value", () => {
    render(<GenerationProgressCard activeStepIndex={GENERATION_STEPS.length - 1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "100");
  });

  it("clamps an out-of-range activeStepIndex to the last step", () => {
    render(<GenerationProgressCard activeStepIndex={99} />);
    const lastStep = GENERATION_STEPS.at(-1);
    expect(lastStep).toBeDefined();
    expect(screen.getByTestId("active-step-label")).toHaveTextContent(lastStep ?? "");
  });

  it("clamps a negative activeStepIndex to the first step", () => {
    render(<GenerationProgressCard activeStepIndex={-3} />);
    expect(screen.getByTestId("active-step-label")).toHaveTextContent(GENERATION_STEPS[0]);
  });
});
