import { Router } from "express";
import crypto from "crypto";

import { uuidv7 } from "uuidv7";
import supabase from "../utils/connectDB.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../utils/generateTokens.js";
import { tokenExchange } from "../utils/githubOauth.js";
import bcrypt from "bcryptjs";

const authRouter = Router();
const stateStore = new Map();

authRouter.get("/github", async (req, res) => {
  try {
    const stateGenerated = crypto.randomBytes(16).toString("hex");
    stateStore.set(stateGenerated, true);
    const params = new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      redirect_uri: process.env.CALLBACK_URI,
      scope: "user:email",
      state: stateGenerated,
    });
    const githubUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    res.redirect(githubUrl);
  } catch (error) {
    console.log(error);
  }
});

authRouter.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;
  try {
    if (!stateStore.has(state)) {
      return res.status(401).send({
        status: "error",
        state,
        stateStore,
      });
    }
    stateStore.delete(state);

    const githubUser = await tokenExchange(code);
    const { id, login, email, avatar_url } = githubUser.data;

    let dbUser = null;
    let dbError = null;

    const { data: existingUser } = await supabase
      .from("users")
      .select()
      .eq("github_id", id)
      .single();
    console.log(existingUser);

    if (existingUser) {
      const { data, error } = await supabase
        .from("users")
        .upsert(
          {
            id: existingUser.id,
            github_id: id,
            username: login,
            email,
            avatar_url,
            role: existingUser.role,
            is_active: true,
            last_login_at: new Date().toISOString(),
          },
          { onConflict: "github_id" },
        )
        .select()
        .single();
      dbUser = data;
      dbError = error;
    } else {
      const { data, error } = await supabase
        .from("users")
        .insert({
          id: uuidv7(),
          github_id: id,
          username: login,
          email,
          avatar_url,
          role: "analyst",
          is_active: true,
          last_login_at: new Date().toISOString(),
        })

        .select()
        .single();
      dbUser = data;
      dbError = error;
    }

    if (dbError) {
      return res.status(500).send({
        status: "error",
        message: dbError.message,
      });
    }

    const accessToken = generateAccessToken(dbUser);
    const refreshToken = generateRefreshToken(dbUser);
    const hashedToken = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");
    const { data, error } = await supabase
      .from("tokens")
      .upsert(
        {
          id: uuidv7(),
          user_id: dbUser.id,
          token_hash: hashedToken,
          expires_at: new Date(Date.now() + 5 * 60 * 1000),
          created_at: new Date(),
        },
        { onConflict: "user_id" },
      )
      .select();

    console.log(data);
    if (error) {
      return res.send({
        status: "upsert/insert error",
        message: error,
      });
    }

    res.status(200).send({
      status: "success",
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: dbUser.id,
        username: dbUser.username,
        role: dbUser.role,
      },
    });
  } catch (error) {
    console.log(error);
  }
});

authRouter.post("/refresh", async (req, res) => {
  // const { refreshToken } = req.body.refresh_token; this is wrong
  //  * Extract the refresh token from the request body
  const { refresh_token: refreshToken } = req.body;

  try {
    //*  Verify the refresh token
    const verifiedRefreshToken = verifyRefreshToken(refreshToken);
    if (!verifiedRefreshToken)
      return res.send({
        status: "token error",
        message: verifiedRefreshToken,
      });
    // * Hash the refresh token to compare with the one in db
    const hashedOldToken = crypto
      .createHash("sha256")
      .update(refreshToken)
      .digest("hex");

    const { data, error } = await supabase
      .from("tokens")
      .select()
      .eq("token_hash", hashedOldToken)
      .single();
    if (error) {
      res.send({ status: "error", message: error });
    }
    // * Check if refresh token has expired
    if (data) {
      //  ->  The below is wrong, you cant compare 2 date objects like that
      //if (data.expires_at === new Date())

      // ✅ correct - check if expiry is in the past
      // if (new Date() > new Date(data.expires_at)) { this doesnt wokr because of timezone issues
      if (new Date() > new Date(data.expires_at + "Z")) {
        return res.status(401).send({
          status: "error",
          message: "Token Expired",
          currentTime: new Date(),
          expiryTime: data.expires_at,
        });
      }
    }
    // * If the token matches, generate a new one

    const { data: dbUser, error: dbError } = await supabase
      .from("users")
      .select()
      .eq("id", data.user_id)
      .single();
    if (dbError)
      return res.send({ status: " /refresh db error", message: dbError });
    const accessToken = generateAccessToken(dbUser);
    const newRefreshToken = generateRefreshToken(dbUser);
    const hashedNewToken = crypto
      .createHash("sha256")
      .update(newRefreshToken)
      .digest("hex");
    await supabase.from("tokens").delete().eq("token_hash", hashedOldToken);
    const { data: tokenData, error: tokenError } = await supabase
      .from("tokens")
      .upsert(
        {
          id: uuidv7(),
          user_id: dbUser.id,
          token_hash: hashedNewToken,
          expires_at: new Date(Date.now() + 5 * 60 * 1000),
        },
        { onConflict: "user_id" },
      )
      .select();
    if (tokenError)
      return res.send({ status: " /refresh Token error", message: tokenError });

    if (error) {
      res.send({
        status: "token db fetch error",
        message: error,
      });
    }
    res.status(200).send({
      status: "success",
      access_token: accessToken,
      refresh_token: newRefreshToken,
    });
  } catch (error) {
    console.log(error);
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .send({ status: "error", message: "Access/Refresh token expired" });
    }
    return res.status(401).send({ status: "error", message: "Invalid token" });
  }
});

authRouter.post("/logout", async (req, res) => {
  const { refresh_token } = req.body;

  try {
    // * Hash the refresh token to compare with the one in db
    const hashedToken = crypto
      .createHash("sha256")
      .update(refresh_token)
      .digest("hex");

    const { data, error } = await supabase
      .from("tokens")
      .delete()
      .eq("token_hash", hashedToken);

    if (error) return res.send({ status: "error", message: error });
    res.send({
      status: "success",
      message: "token invalidated",
    });
  } catch (error) {
    res.send(error);
  }
});
export default authRouter;
