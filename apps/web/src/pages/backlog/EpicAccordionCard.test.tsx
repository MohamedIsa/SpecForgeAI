import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EpicAccordionCard, type BacklogEpic, type BacklogTicket } from "./EpicAccordionCard";

function makeTicket(overrides: Partial<BacklogTicket> = {}): BacklogTicket {
  return {
    ref: "T1",
    previewKey: "CHK-101",
    title: "Add login form",
    type: "story",
    priority: "P1",
    storyPoints: 3,
    acceptanceCriteria: [
      { given: "a visitor", when: "they submit valid credentials", then: "they are logged in" },
    ],
    aiDevPrompt: "Implement a login form with email and password fields.",
    dependsOn: [],
    dependsOnPreviewKeys: [],
    ...overrides,
  };
}

function makeEpic(overrides: Partial<BacklogEpic> = {}): BacklogEpic {
  return {
    title: "Authentication",
    tickets: [makeTicket()],
    ...overrides,
  };
}

describe("EpicAccordionCard — header", () => {
  it("shows the epic title, ticket count and point total", () => {
    const epic = makeEpic({
      tickets: [makeTicket({ ref: "T1", storyPoints: 3 }), makeTicket({ ref: "T2", storyPoints: 5 })],
    });
    render(<EpicAccordionCard epic={epic} />);
    expect(screen.getByText("Authentication")).toBeInTheDocument();
    expect(screen.getByText("2 tickets · 8 pts")).toBeInTheDocument();
  });

  it("pluralises a single ticket as singular", () => {
    render(<EpicAccordionCard epic={makeEpic({ tickets: [makeTicket({ storyPoints: 3 })] })} />);
    expect(screen.getByText("1 ticket · 3 pts")).toBeInTheDocument();
  });
});

describe("EpicAccordionCard — expand/collapse", () => {
  it("is collapsed by default", () => {
    render(<EpicAccordionCard epic={makeEpic()} />);
    expect(screen.queryByTestId("backlog-ticket-card")).not.toBeInTheDocument();
  });

  it("expands to show tickets when defaultOpen is set", () => {
    render(<EpicAccordionCard epic={makeEpic()} defaultOpen />);
    expect(screen.getByTestId("backlog-ticket-card")).toBeInTheDocument();
  });

  it("toggles open and closed on click", () => {
    render(<EpicAccordionCard epic={makeEpic()} />);
    const header = screen.getByRole("button", { name: /Authentication/ });

    fireEvent.click(header);
    expect(screen.getByTestId("backlog-ticket-card")).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.queryByTestId("backlog-ticket-card")).not.toBeInTheDocument();
  });
});

describe("EpicAccordionCard — ticket card", () => {
  it("shows the monospaced key, type badge, priority pill and story points", () => {
    render(
      <EpicAccordionCard
        epic={makeEpic({ tickets: [makeTicket({ previewKey: "CHK-101", type: "bug", priority: "P0", storyPoints: 8 })] })}
        defaultOpen
      />,
    );
    expect(screen.getByTestId("ticket-key")).toHaveTextContent("CHK-101");
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("P0")).toBeInTheDocument();
    expect(screen.getByText("8 pts")).toBeInTheDocument();
  });

  it("renders a dependency pill referencing the depended-on ticket's preview key", () => {
    render(
      <EpicAccordionCard
        epic={makeEpic({
          tickets: [makeTicket({ dependsOn: ["T0"], dependsOnPreviewKeys: ["CHK-100"] })],
        })}
        defaultOpen
      />,
    );
    expect(screen.getByTestId("dependency-pill")).toHaveTextContent("Depends on CHK-100");
  });

  it("omits the dependency pill when there is nothing to depend on", () => {
    render(<EpicAccordionCard epic={makeEpic()} defaultOpen />);
    expect(screen.queryByTestId("dependency-pill")).not.toBeInTheDocument();
  });

  it("renders the Given/When/Then checklist", () => {
    render(<EpicAccordionCard epic={makeEpic()} defaultOpen />);
    const criteria = screen.getByTestId("acceptance-criteria");
    expect(criteria).toHaveTextContent("Given a visitor, when they submit valid credentials, then they are logged in");
    expect(screen.getByText("Given")).toBeInTheDocument();
    expect(screen.getByText("when")).toBeInTheDocument();
    expect(screen.getByText("then")).toBeInTheDocument();
  });

  it("keeps the AI Dev Prompt collapsed until expanded", () => {
    render(<EpicAccordionCard epic={makeEpic()} defaultOpen />);
    expect(screen.queryByTestId("ai-dev-prompt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /AI Dev Prompt/ }));
    expect(screen.getByTestId("ai-dev-prompt")).toHaveTextContent(
      "Implement a login form with email and password fields.",
    );
  });
});
