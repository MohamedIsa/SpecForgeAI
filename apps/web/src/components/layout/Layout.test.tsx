import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Layout } from "./Layout.tsx";

describe("Layout", () => {
  it("renders children content", () => {
    render(
      <Layout>
        <div data-testid="content">Hello</div>
      </Layout>,
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("renders sidebar with logo", () => {
    render(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getByText("SpecForge AI")).toBeInTheDocument();
  });

  it("renders header with breadcrumb", () => {
    render(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getByText("clarify")).toBeInTheDocument();
    expect(screen.getByText("open questions")).toBeInTheDocument();
  });

  it("renders navigation items", () => {
    render(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Ingest")).toBeInTheDocument();
    expect(screen.getByText("Board")).toBeInTheDocument();
  });

  it("toggles sidebar on button click", () => {
    render(
      <Layout>
        <div />
      </Layout>,
    );
    const toggleButton = screen.getByLabelText("Toggle sidebar");
    expect(toggleButton).toBeInTheDocument();
    fireEvent.click(toggleButton);
  });

  it("renders user profile section", () => {
    render(
      <Layout>
        <div />
      </Layout>,
    );
    expect(screen.getByText("Mohamed Isa")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });
});
