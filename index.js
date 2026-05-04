import express from "express";
import cors from "cors";
import { uuidv7 } from "uuidv7";
import axios from "axios";
import supabase from "./utils/connectDB.js";
import fs from "fs";
import { getData } from "country-list";
import profilesRouter from "./routes/profiles.js";
import authRouter from "./routes/auth.js";

const app = express();
app.use(cors({ origin: "*" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});
app.use(express.json());

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

const COUNTRY_ALIASES = new Map([
  ["usa", "US"],
  ["us", "US"],
  ["u.s.", "US"],
  ["united states", "US"],
  ["united states of america", "US"],
  ["uk", "GB"],
  ["u.k.", "GB"],
  ["united kingdom", "GB"],
]);

const COUNTRY_NAME_TO_ID = (() => {
  const m = new Map();
  for (const { name, code } of getData()) {
    m.set(String(name).toLowerCase(), code);
  }
  for (const [k, v] of COUNTRY_ALIASES.entries()) m.set(k, v);
  return m;
})();

const hasAnyToken = (tokenSet, tokens) => tokens.some((t) => tokenSet.has(t));

const parsePositiveInt = (val) => {
  if (val === undefined) return null;
  if (typeof val !== "string" || val.trim() === "") return NaN;
  const n = Number.parseInt(val, 10);
  return Number.isFinite(n) ? n : NaN;
};

const parsePositiveFloat = (val) => {
  if (val === undefined) return null;
  if (typeof val !== "string" || val.trim() === "") return NaN;
  const n = Number.parseFloat(val);
  return Number.isFinite(n) ? n : NaN;
};

const getPagination = (pageRaw, limitRaw) => {
  const page = pageRaw === undefined ? 1 : parsePositiveInt(pageRaw);
  const limit = limitRaw === undefined ? 10 : parsePositiveInt(limitRaw);

  if (!Number.isInteger(page) || page < 1) return { error: true };
  if (!Number.isInteger(limit) || limit < 1) return { error: true };

  const cappedLimit = Math.min(limit, 50);
  const start = (page - 1) * cappedLimit;
  const end = start + cappedLimit - 1;
  return { page, limit: cappedLimit, start, end };
};

const parseCountryIdFromText = (raw) => {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  if (/^[a-z]{2}$/.test(s)) return s.toUpperCase();
  return COUNTRY_NAME_TO_ID.get(s) || null;
};

const intersectAgeRange = (currMin, currMax, nextMin, nextMax) => {
  const min =
    nextMin == null
      ? currMin
      : currMin == null
        ? nextMin
        : Math.max(currMin, nextMin);
  const max =
    nextMax == null
      ? currMax
      : currMax == null
        ? nextMax
        : Math.min(currMax, nextMax);
  return { min, max };
};

const parseNaturalLanguageFilters = (q) => {
  const text = String(q || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const words = text.split(" ").filter(Boolean);
  const wordSet = new Set(words);

  const filters = {};

  // Gender (if both appear, don't filter by gender)
  // Token-based matching avoids false positives like "female" containing "male".
  const hasMale = hasAnyToken(wordSet, [
    "male",
    "males",
    "man",
    "men",
    "boy",
    "boys",
  ]);
  const hasFemale = hasAnyToken(wordSet, [
    "female",
    "females",
    "woman",
    "women",
    "girl",
    "girls",
  ]);
  if (hasMale && !hasFemale) filters.gender = "male";
  if (hasFemale && !hasMale) filters.gender = "female";

  // Age group
  if (hasAnyToken(wordSet, ["child", "children"])) filters.age_group = "child";
  if (hasAnyToken(wordSet, ["teenager", "teenagers", "teen", "teens"]))
    filters.age_group = "teenager";
  if (hasAnyToken(wordSet, ["adult", "adults"])) filters.age_group = "adult";
  if (hasAnyToken(wordSet, ["senior", "seniors", "elderly"]))
    filters.age_group = "senior";

  let minAge = null;
  let maxAge = null;

  // "young" is a parsing-only rule
  if (wordSet.has("young")) {
    ({ min: minAge, max: maxAge } = intersectAgeRange(minAge, maxAge, 16, 24));
  }

  // between 20 and 30
  {
    const m = text.match(/\bbetween\s+(\d{1,3})\s+and\s+(\d{1,3})\b/);
    if (m) {
      const a = Number.parseInt(m[1], 10);
      const b = Number.parseInt(m[2], 10);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      ({ min: minAge, max: maxAge } = intersectAgeRange(
        minAge,
        maxAge,
        lo,
        hi,
      ));
    }
  }

  // aged 20-30 / age 20 to 30
  {
    const m = text.match(/\b(?:age|aged)\s+(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\b/);
    if (m) {
      const a = Number.parseInt(m[1], 10);
      const b = Number.parseInt(m[2], 10);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      ({ min: minAge, max: maxAge } = intersectAgeRange(
        minAge,
        maxAge,
        lo,
        hi,
      ));
    }
  }

  // above / over / older than / at least / 30+
  {
    const m = text.match(/\b(?:above|over|older than|at least)\s+(\d{1,3})\b/);
    const m2 = text.match(/\b(\d{1,3})\s*\+\b/);
    const n = m
      ? Number.parseInt(m[1], 10)
      : m2
        ? Number.parseInt(m2[1], 10)
        : null;
    if (n != null)
      ({ min: minAge, max: maxAge } = intersectAgeRange(
        minAge,
        maxAge,
        n,
        null,
      ));
  }

  // below / under / younger than / at most
  {
    const m = text.match(
      /\b(?:below|under|younger than|at most)\s+(\d{1,3})\b/,
    );
    if (m) {
      const n = Number.parseInt(m[1], 10);
      ({ min: minAge, max: maxAge } = intersectAgeRange(
        minAge,
        maxAge,
        null,
        n,
      ));
    }
  }

  if (minAge != null) filters.min_age = minAge;
  if (maxAge != null) filters.max_age = maxAge;

  if (
    filters.min_age != null &&
    filters.max_age != null &&
    filters.min_age > filters.max_age
  ) {
    return null;
  }

  // Country: parse "from X" or "in X" (stop at known keywords)
  {
    const tokens = words;
    const startIdx = tokens.findIndex((t) => t === "from" || t === "in");
    if (startIdx !== -1 && startIdx + 1 < tokens.length) {
      const stop = new Set([
        "and",
        "male",
        "males",
        "female",
        "females",
        "man",
        "men",
        "woman",
        "women",
        "boy",
        "boys",
        "girl",
        "girls",
        "people",
        "person",
        "persons",
        "young",
        "child",
        "children",
        "teen",
        "teens",
        "teenager",
        "teenagers",
        "adult",
        "adults",
        "senior",
        "seniors",
        "elderly",
        "above",
        "over",
        "under",
        "below",
        "between",
        "aged",
        "age",
        "older",
        "than",
        "least",
        "most",
      ]);

      const countryTokens = [];
      for (let i = startIdx + 1; i < tokens.length; i++) {
        if (stop.has(tokens[i])) break;
        countryTokens.push(tokens[i]);
      }
      const candidate = countryTokens.join(" ").trim();
      const countryId = parseCountryIdFromText(candidate);
      if (countryId) filters.country_id = countryId;
    }
  }

  return Object.keys(filters).length ? filters : null;
};

const data = JSON.parse(fs.readFileSync("./seed_profiles.json", "utf8"));
const extractedProfiles = data.profiles; // this is the actual array
const profiles = extractedProfiles.map((profile) => ({
  ...profile,
  id: uuidv7(),
  name: profile.name.toLowerCase(),
}));

const uploadProfiles = async () => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .upsert(profiles, {
        onConflict: "name",
        count: "exact",
      })
      .select();
    console.log(data);
    if (error) {
      console.log(error);
    }
  } catch (error) {
    console.log(error);
  }
};
//uploadProfiles();
const genderizeApi = async (name) => {
  try {
    const response = await axios.get(`https://api.genderize.io?name=${name}`);
    const data = response.data;
    return data;
  } catch (error) {
    console.log(error);
  }
};

const agifyApi = async (name) => {
  try {
    const response = await axios.get(`https://api.agify.io?name=${name}`);
    const data = response.data;

    return data;
  } catch (error) {
    console.log(error);
  }
};
const nationalizeApi = async (name) => {
  try {
    const response = await axios.get(`https://api.nationalize.io?name=${name}`);
    const data = response.data;

    return data;
  } catch (error) {
    console.log(error);
  }
};

const duplicateCheck = async (name) => {
  const { data, error } = await supabase
    .from("profiles")
    .select()
    .eq("name", name);

  return { data, error };
};

app.use("/api/profiles", profilesRouter);
app.use("/auth", authRouter);
