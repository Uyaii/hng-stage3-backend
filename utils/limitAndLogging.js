import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, //* 1 minute
  limit: 10, //* 10 req per minute
  message: { status: "error", message: "Too many requests" },
  statusCode: 429,
});

export const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 60,
  message: { status: "error", message: "Too many requests" },
  statusCode: 429,
});
