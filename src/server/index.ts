import express from "express";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "viber-online", time: new Date().toISOString() });
});

const port = Number(process.env.PORT ?? 5000);
app.listen(port, "0.0.0.0", () => {
  console.log(`viber-online listening on :${port}`);
});
