import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TicketCard, type TicketCardData } from "./TicketCard";

function makeTicket(overrides: Partial<TicketCardData> = {}): TicketCardData {
  return {
    id: "ticket-1",
    key: "CHK-101",
    type: "story",
    title: "Implement login flow",
    priority: "P0",
    storyPoints: 5,
    assignee: { initials: "MI", fullName: "Mohamed Isa" },
    ...overrides,
  };
}

describe("TicketCard", () => {
  it("renders the monospaced ticket key and title", () => {
    render(<TicketCard ticket={makeTicket()} />);
    expect(screen.getByText("CHK-101")).toBeInTheDocument();
    expect(screen.getByText("Implement login flow")).toBeInTheDocument();
  });

  it.each([
    ["story", "Story"],
    ["bug", "Bug"],
    ["task", "Task"],
  ] as const)("renders the %s type icon", (type, label) => {
    render(<TicketCard ticket={makeTicket({ type })} />);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it.each([
    ["P0", "bg-priority-p0-bg", "text-error"],
    ["P1", "bg-priority-p1-bg", "text-warning"],
    ["P2", "bg-priority-p2-bg", "text-primary"],
    ["P3", "bg-priority-p3-bg", "text-text-secondary"],
  ] as const)("renders the %s priority pill with its color classes", (priority, bgClass, textClass) => {
    render(<TicketCard ticket={makeTicket({ priority })} />);
    const pill = screen.getByText(priority);
    expect(pill.className).toContain(bgClass);
    expect(pill.className).toContain(textClass);
  });

  it("renders the story points badge when present", () => {
    render(<TicketCard ticket={makeTicket({ storyPoints: 8 })} />);
    expect(screen.getByText("8 pts")).toBeInTheDocument();
  });

  it("omits the story points badge when null", () => {
    render(<TicketCard ticket={makeTicket({ storyPoints: null })} />);
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument();
  });

  it("renders the assignee's initials with a full-name tooltip when assigned", () => {
    render(
      <TicketCard
        ticket={makeTicket({ assignee: { initials: "GH", fullName: "Grace Hopper" } })}
      />,
    );
    const avatar = screen.getByText("GH");
    expect(avatar).toHaveAttribute("title", "Grace Hopper");
  });

  it("omits the assignee avatar when unassigned", () => {
    render(<TicketCard ticket={makeTicket({ assignee: null })} />);
    expect(screen.queryByTitle(/./)).not.toBeInTheDocument();
  });
});
