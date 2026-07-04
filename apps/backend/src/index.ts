import { buildApp } from "./server";

async function main() {
  const server = await buildApp();

  try {
    const port = parseInt(process.env["PORT"] ?? "3001", 10);
    await server.listen({ port, host: "0.0.0.0" });

    server.log.info(
      { routes: server.printRoutes() },
      "registered routes",
    );
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

void main();
