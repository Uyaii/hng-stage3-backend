import express from "express";
import cors from "cors";
import { uuidv7 } from "uuidv7";
import axios from "axios";
import supabase from "./utils/connectDB.js";
import fs from "fs";
import { getData } from "country-list";
import profilesRouter from "./routes/profiles.js";
import authRouter from "./routes/auth.js";
import authMiddleware from "./middleware/auth.js";
import apiVersionMiddleware from "./middleware/apiVersion.js";
import rateLimit from "express-rate-limit";
import { authLimiter, generalLimiter } from "./utils/limitAndLogging.js";
import morgan from "morgan";

const app = express();
app.use(cors({ origin: "*" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});
app.use(express.json());

app.use(morgan("dev"));

const port = process.env.PORT || 3000;

const startServer = async () => {
  try {
    const { data, error } = await supabase.from("profiles").select("*");
    if (error) {
      console.log("DB connection failed:", error.message);
    } else {
      console.log("DB connected successfully");
    }
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.log(error);
  }
};

startServer();

app.use("/api", generalLimiter, authMiddleware, apiVersionMiddleware);
app.use("/api/profiles", profilesRouter);
app.use("/auth", authLimiter, authRouter);
