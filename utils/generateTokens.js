import jwt from "jsonwebtoken";

export const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role, username: user.username },
    process.env.JWT_SECRET,
    {
      expiresIn: "3m",
    },
  );
};

export const generateRefreshToken = (user) => {
  return jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "5m" });
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};
