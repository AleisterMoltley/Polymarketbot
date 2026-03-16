import { Router, Request, Response } from "express";
import { getAllTrades, getStats } from "./stats";
import { getSnapshot } from "../utils/jsonStore";

const router = Router();

/** GET /admin — simple HTML dashboard shell */
router.get("/", (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Polymarketbot Admin</title>
  <style>
    body { font-family: sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; }
    nav { background: #161b22; padding: 12px 24px; display: flex; gap: 24px; }
    nav a { color: #58a6ff; text-decoration: none; font-weight: 600; }
    nav a:hover { text-decoration: underline; }
    section { padding: 24px; }
    h1 { font-size: 1.4rem; color: #e6edf3; }
    iframe { width: 100%; height: 70vh; border: none; background: #0d1117; }
  </style>
</head>
<body>
  <nav>
    <a href="/admin">Dashboard</a>
    <a href="/admin/stats">Stats</a>
    <a href="/admin/trades">Trades</a>
    <a href="/admin/store">Store</a>
  </nav>
  <section>
    <h1>Polymarketbot — Admin Dashboard</h1>
    <p>Select a tab above to inspect bot state.</p>
  </section>
</body>
</html>`);
});

/** GET /admin/stats — aggregate statistics as JSON */
router.get("/stats", (_req: Request, res: Response) => {
  res.json(getStats());
});

/** GET /admin/trades — full trade history as JSON */
router.get("/trades", (_req: Request, res: Response) => {
  res.json(getAllTrades());
});

/** GET /admin/store — raw in-memory store snapshot */
router.get("/store", (_req: Request, res: Response) => {
  res.json(getSnapshot());
});

export default router;
