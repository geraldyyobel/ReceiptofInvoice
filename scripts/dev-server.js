import "dotenv/config";
process.env.PORT = process.env.API_PORT || "3000";
await import("./start-app.js");
