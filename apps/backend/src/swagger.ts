import type { FastifyInstance } from "fastify";

export async function registerOpenAPI(server: FastifyInstance): Promise<void> {
  await server.register(import("@fastify/swagger"), {
    openapi: {
      info: {
        title: "SpecForge AI API",
        description:
          "BRD Tech Stack & Ticket Extractor backend. All endpoints use tRPC over HTTP — queries use GET with `?input=...`, mutations use POST with JSON body.",
        version: "0.1.0",
      },
      servers: [
        {
          url: "http://localhost:3001",
          description: "Local development",
        },
      ],
      tags: [
        { name: "Health", description: "Health check" },
        { name: "BRD", description: "BRD upload and extraction" },
        { name: "Backlog", description: "Kanban board and ticket management" },
      ],
      paths: {
        "/trpc/health": {
          get: {
            tags: ["Health"],
            summary: "Health check",
            operationId: "health",
            responses: {
              "200": {
                description: "Server is healthy",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        result: {
                          type: "object",
                          properties: {
                            data: {
                              type: "object",
                              properties: {
                                status: { type: "string" },
                                timestamp: { type: "number" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/trpc/brd.uploadBrd": {
          post: {
            tags: ["BRD"],
            summary: "Upload BRD for processing",
            operationId: "uploadBrd",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["fileBase64", "fileName"],
                    properties: {
                      fileBase64: { type: "string" },
                      fileName: { type: "string" },
                      targetTechStack: { type: "string" },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Upload initiated",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        result: {
                          type: "object",
                          properties: {
                            data: {
                              type: "object",
                              properties: { uploadId: { type: "string" } },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/trpc/brd.getUploadStatus": {
          get: {
            tags: ["BRD"],
            summary: "Get BRD upload status",
            operationId: "getUploadStatus",
            parameters: [
              {
                name: "input",
                in: "query",
                required: true,
                description:
                  'JSON-encoded string, e.g. "abc123" (sent as ?input=%22abc123%22)',
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Upload status",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        result: {
                          type: "object",
                          properties: {
                            data: {
                              type: "object",
                              properties: {
                                uploadId: { type: "string" },
                                status: { type: "string" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              "404": { description: "Upload not found" },
            },
          },
        },
        "/trpc/backlog.getBacklog": {
          get: {
            tags: ["Backlog"],
            summary: "Get backlog epics and tickets",
            operationId: "getBacklog",
            parameters: [
              {
                name: "input",
                in: "query",
                required: false,
                description:
                  'Optional JSON string, e.g. {"epicId":"epic-0"}',
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Backlog data",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        result: {
                          type: "object",
                          properties: {
                            data: {
                              type: "array",
                              items: { type: "object" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/trpc/backlog.createTicket": {
          post: {
            tags: ["Backlog"],
            summary: "Create a ticket manually",
            operationId: "createTicket",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id", "epicId", "title", "type", "priority", "storyPoints"],
                    properties: {
                      id: { type: "string" },
                      epicId: { type: "string" },
                      title: { type: "string" },
                      type: { type: "string" },
                      priority: { type: "string" },
                      storyPoints: { type: "number" },
                      status: { type: "string" },
                      dependencies: {
                        type: "array",
                        items: { type: "string" },
                      },
                      description: { type: "string" },
                      acceptanceCriteria: {
                        type: "array",
                        items: { type: "string" },
                      },
                      aiDevPrompt: { type: "string" },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Ticket created",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        result: {
                          type: "object",
                          properties: {
                            data: {
                              type: "object",
                              properties: {
                                id: { type: "string" },
                                title: { type: "string" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/trpc/backlog.updateTicketStatus": {
          post: {
            tags: ["Backlog"],
            summary: "Update ticket status",
            operationId: "updateTicketStatus",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["ticketId", "status"],
                    properties: {
                      ticketId: { type: "string" },
                      status: { type: "string" },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Status updated",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        result: {
                          type: "object",
                          properties: {
                            data: {
                              type: "object",
                              properties: {
                                id: { type: "string" },
                                status: { type: "string" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/trpc/backlog.extractTicketFromPrompt": {
          post: {
            tags: ["Backlog"],
            summary: "Extract a ticket from a text prompt via AI",
            operationId: "extractTicketFromPrompt",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["prompt", "epicId"],
                    properties: {
                      prompt: { type: "string" },
                      epicId: { type: "string" },
                    },
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "Ticket extracted and persisted",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        result: {
                          type: "object",
                          properties: {
                            data: {
                              type: "object",
                              properties: {
                                id: { type: "string" },
                                title: { type: "string" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as never,
  });

  await server.register(import("@fastify/swagger-ui"), {
    routePrefix: "/docs",
  });
}
