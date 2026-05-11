import { Router } from "express";
import supabase from "../utils/connectDB.js";
import { uuidv7 } from "uuidv7";
import axios from "axios";

import fs from "fs";
import { getData } from "country-list";
import roleMiddleware from "../middleware/role.js";
import { exportCsv } from "../utils/exportCsv.js";

const profilesRouter = Router();

const COUNTRY_ALIASES = new Map([
  ["usa", "US"],
  ["us", "US"],
  ["u.s.", "US"],
  ["united states", "US"],
  ["united states of america", "US"],
  ["uk", "GB"],
  ["u.k.", "GB"],
  ["united kingdom", "GB"],
  ["liberia", "LR"],
  ["nigeria", "NG"],
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
const buildProfilesParams = (queryParams) => {
  const {
    gender,
    country_id,
    age_group,
    sort_by,
    order,
    min_age,
    max_age,
    min_gender_probability,
    min_country_probability,
  } = queryParams;

  let query = supabase.from("profiles").select("*", { count: "exact" });

  // * FILTERTING
  if (gender) {
    query = query.eq("gender", gender.toLowerCase());
  }
  if (country_id) {
    query = query.eq("country_id", country_id.toUpperCase());
  }
  if (age_group) {
    query = query.eq("age_group", age_group.toLowerCase());
  }

  const minAgeNum = parsePositiveInt(min_age);
  const maxAgeNum = parsePositiveInt(max_age);
  const minGenderProbNum = parsePositiveFloat(min_gender_probability);
  const minCountryProbNum = parsePositiveFloat(min_country_probability);

  if (
    Number.isNaN(minAgeNum) ||
    Number.isNaN(maxAgeNum) ||
    Number.isNaN(minGenderProbNum) ||
    Number.isNaN(minCountryProbNum)
  ) {
    return { query: null, error: "Invalid query parameters" };
  }

  if (minAgeNum != null) query = query.gte("age", minAgeNum);
  if (maxAgeNum != null) query = query.lte("age", maxAgeNum);
  if (minGenderProbNum != null)
    query = query.gte("gender_probability", minGenderProbNum);
  if (minCountryProbNum != null)
    query = query.gte("country_probability", minCountryProbNum);

  if (minAgeNum != null && maxAgeNum != null && minAgeNum > maxAgeNum) {
    return { query: null, error: "Invalid query parameters" };
  }
  let orderBool = null;
  // * SORTING
  if (sort_by) {
    const allowedSort = new Set(["age", "created_at", "gender_probability"]);
    if (!allowedSort.has(sort_by)) {
      return { query: null, error: "Invalid query parameters" };
    }

    if (order === undefined) {
      orderBool = true;
    } else if (order === "asc") {
      orderBool = true;
    } else if (order === "desc") {
      orderBool = false;
    } else {
      return { query: null, error: "Invalid query parameters" };
    }

    query = query.order(sort_by, {
      ascending: orderBool,
    });
  }
  return { query };
};
profilesRouter.get("/", async (req, res) => {
  const {
    gender,
    country_id,
    age_group,
    sort_by,
    order,
    page,
    limit,
    min_age,
    max_age,
    min_gender_probability,
    min_country_probability,
  } = req.query;

  const pagination = getPagination(page, limit);
  if (pagination.error) {
    return res
      .status(422)
      .send({ status: "error", message: "Invalid query parameters" });
  }
  let { query, error } = buildProfilesParams(req.query);
  if (error) return res.status(422).send({ status: "error", message: error });

  // * PAGINATION

  query = query.range(pagination.start, pagination.end);

  try {
    const { data, error, count } = await query;
    if (error) {
      return res.status(500).send({
        status: "error",
        message: error.message || "Server failure",
      });
    }
    if (data.length >= 1 || data.length === 0) {
      return res.status(200).send({
        status: "success",
        page: pagination.page,
        limit: pagination.limit,
        total: count,
        total_pages: Math.round(count / pagination.limit),
        links: {
          self: `/api/profiles?page=${pagination.page}&limit=${pagination.limit}`,
          next: `/api/profiles?page=${pagination.page + 1}&limit=${pagination.limit}`,
          prev:
            page > 1
              ? `/api/profiles?page=${pagination.page - 1}&limit=${pagination.limit}`
              : null,
        },
        data,
      });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).send({
      status: "error",
      message: "Server failure",
    });
  }
});

profilesRouter.get("/search", async (req, res) => {
  const { q, page, limit } = req.query;

  if (typeof q !== "string" || q.trim() === "") {
    return res.status(400).send({
      status: "error",
      message: "Missing or empty parameter",
    });
  }

  const pagination = getPagination(page, limit);
  if (pagination.error) {
    return res
      .status(422)
      .send({ status: "error", message: "Invalid query parameters" });
  }

  const filters = parseNaturalLanguageFilters(q);
  if (!filters) {
    return res.status(422).send({
      status: "error",
      message: "Unable to interpret query",
    });
  }

  let query = supabase.from("profiles").select("*", { count: "exact" });
  if (filters.gender) query = query.eq("gender", filters.gender);
  if (filters.age_group) query = query.eq("age_group", filters.age_group);
  if (filters.country_id) query = query.eq("country_id", filters.country_id);
  if (filters.min_age != null) query = query.gte("age", filters.min_age);
  if (filters.max_age != null) query = query.lte("age", filters.max_age);

  query = query.range(pagination.start, pagination.end);

  try {
    const { data, error, count } = await query;
    if (error) {
      return res.status(500).send({
        status: "error",
        message: error.message || "Server failure",
      });
    }

    return res.status(200).send({
      status: "success",
      page: pagination.page,
      limit: pagination.limit,
      total: count,
      total_pages: Math.round(count / pagination.limit),
      links: {
        self: `/api/profiles?page=${pagination.page}&limit=${pagination.limit}`,
        next: `/api/profiles?page=${pagination.page + 1}&limit=${pagination.limit}`,
        prev:
          page > 1
            ? `/api/profiles?page=${pagination.page - 1}&limit=${pagination.limit}`
            : null,
      },
      data,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).send({
      status: "error",
      message: "Server failure",
    });
  }
});

profilesRouter.post("/", roleMiddleware("admin"), async (req, res) => {
  const { name } = req.body;
  // ! Missing or Empty Name Error Handling
  if (!name || name.trim() === "") {
    return res.status(400).send({
      status: "error",
      message: "Missing Name or Empty Name",
    });
  }
  // ! Numeric Name Error Handling
  if (typeof name !== "string") {
    return res.status(422).send({
      status: "error",
      message: "Numeric Name instead of String",
    });
  }

  const nameInsensitive = name.toLowerCase();
  const { data, error } = await duplicateCheck(nameInsensitive);
  if (data.length >= 1) {
    return res.status(201).send({
      status: "success",
      message: "Profile already exists",
      data: data[0],
    });
  }

  let externalApi = "";
  try {
    //   * GENDERIZE
    externalApi = "Genderize";
    const genderDetails = await genderizeApi(name);
    const { gender, probability, count } = genderDetails;
    const sample_size = count;
    if (gender === null || count === 0) {
      return res.status(400).send({
        status: "error",
        message: `${externalApi} returned an invalid response`,
      });
    }

    // * AGIFY
    externalApi = "Agify";
    const ageDetails = await agifyApi(name);
    const { age } = ageDetails;
    if (age === null) {
      return res.status(502).send({
        status: "error",
        message: `${externalApi} returned an invalid response`,
      });
    }
    let age_group = "";
    if (age <= 12) {
      age_group = "child";
    } else if (age >= 13 && age <= 19) {
      age_group = "teenager";
    } else if (age >= 20 && age <= 59) {
      age_group = "adult";
    } else {
      age_group = "senior";
    }

    // * NATIONALIZE
    externalApi = "Nationalize";
    const countryDetails = await nationalizeApi(name);

    if (!countryDetails.country || countryDetails.country.length === 0) {
      return res.status(502).send({
        status: "error",
        message: `${externalApi} returned an invalid response`,
      });
    }
    const firstCountry = countryDetails.country[0];
    const countries = getData();
    const countryName = countries.find(
      (c) => c.code === firstCountry.country_id,
    )?.name;
    const extractedData = {
      id: uuidv7(),
      name: nameInsensitive,
      gender,
      gender_probability: probability,

      age,
      age_group,
      country_id: firstCountry.country_id,
      country_name:
        countryName.charAt(0).toUpperCase() +
        countryName.slice(1).toLowerCase(),
      country_probability: firstCountry.probability,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("profiles")
      .insert(extractedData);
    if (error) {
      return res.status(400).json(error);
    }

    res.status(201).send({ status: "success", data: extractedData });
  } catch (error) {
    console.log(error);
  }
});

profilesRouter.get("/export", async (req, res) => {
  const { format } = req.query;
  if (format !== "csv")
    return res.send({ status: "error", message: "CSV only" });
  const { query, error } = buildProfilesParams(req.query);
  if (error) return res.status(422).send({ status: "error", message: error });
  const { data: profilesData, error: profilesError } = await query;
  // .from("profiles")
  // .select(); -> no need for this again because its already done in query

  if (profilesError)
    return res.send({ status: "error", message: profilesError });
  const data = profilesData;
  return exportCsv(res, `profiles_${new Date().toISOString()}.csv`, data);
});

export default profilesRouter;
