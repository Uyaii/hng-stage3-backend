import crypto from "crypto";
import jwt from "jsonwebtoken";

export const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role, username: user.username },
    process.env.JWT_SECRET,
    {
      expiresIn: "5m",
    },
  );
};

export const generateRefreshToken = (user) => {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
    expiresIn: "10m",
  });
};

export const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

export const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};
