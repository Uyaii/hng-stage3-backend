import supabase from "../utils/connectDB.js";
import { verifyToken } from "../utils/tokenUtils.js";

const authMiddleware = async (req, res, next) => {
  try {
    if (!req.headers.authorization)
      return res
        .status(401)
        .send({ status: "error", message: "No authorization header" });
    
    const token = req.headers.authorization.split(" ")[1];
    const user = verifyToken(token); // ! this returns the payload that was signed in the first place ie id,role etc
    if (!user) return res.status(401).send({ status: "error", message: user });

    const { data: dbUser, error: dbError } = await supabase
      .from("users")
      .select()
      .eq("id", user.id)
      .single();

    if (dbError)
      return res.status(401).send({ status: "error", message: dbError });
    if (!dbUser)
      return res
        .status(401)
        .send({ status: "error", message: "User Not Found" });
    if (dbUser.is_active === false)
      return res
        .status(403)
        .send({ status: "error", message: "Inactive User" });
    req.user = dbUser;
    next();

    
  } catch (error) {
    res.send({ status: "error", message: error });
  }
};

export default authMiddleware;
