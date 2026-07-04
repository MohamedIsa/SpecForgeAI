export type TicketType =
  | "setup"
  | "feature"
  | "infra"
  | "integration"
  | "testing"
  | "bugfix";

export type Priority = "P0" | "P1" | "P2" | "P3";

export type TicketStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "done";

export type UploadStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export const STORY_POINTS = [1, 2, 3, 5, 8] as const;
export type StoryPoints = (typeof STORY_POINTS)[number];

export interface Epic {
  id: string;
  title: string;
  description: string | null;
  created_at: Date;
}

export interface Ticket {
  id: string;
  epic_id: string;
  title: string;
  type: TicketType;
  priority: Priority;
  story_points: StoryPoints;
  status: TicketStatus;
  dependencies: string[];
  description: string | null;
  acceptance_criteria: string[];
  ai_dev_prompt: string | null;
  created_at: Date;
}

export interface BrdUpload {
  id: string;
  file_name: string;
  file_path: string | null;
  status: UploadStatus;
  validation_report: Record<string, unknown> | null;
  created_at: Date;
}

export interface TechStack {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  stack_config: Record<string, unknown>;
  created_at: Date;
}
