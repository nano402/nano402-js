import express from "express";
import dotenv from "dotenv";
import { Nano402, nano402Guard } from "@nano402/express";

dotenv.config();

const app = express();
app.use(express.json());

// Initialize Nano402
const nano402 = new Nano402({
  walletSeed:
    process.env.NANO_SEED ||
    "0000000000000000000000000000000000000000000000000000000000000000",
  nanoRpcUrl: process.env.NANO_RPC_URL || "https://node.somenano.com/proxy",
});

// Public route
app.get("/", (req, res) => {
  res.json({
    message: "Nano 402 Payment Server",
    endpoints: {
      protected: "/api/secret-data",
    },
  });
});

// Protected route with 402 payment
app.get(
  "/api/secret-data",
  nano402Guard(nano402, {
    amount_xno: "0.00001",
    ttlSeconds: 3600,
    description: "Access to premium secret data", // Description shown in 402 response
    makeItPublic: false, // Track payments by IP - enables parameter-free unlocking!
    sessionDuration: 1000, // 1 minute session
    maxUsage: 5,
  }),
  (req, res) => {
    res.json({
      message: "Here is your broccoli! 🥦",
      timestamp: new Date().toISOString(),
    });
  }
);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Protected endpoint: http://localhost:${PORT}/api/secret-data`);
});
