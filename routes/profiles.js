import { Router } from "express";

const profilesRouter = Router();

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
  let query = supabase.from("profiles").select("*", { count: "exact" });

  const pagination = getPagination(page, limit);
  if (pagination.error) {
    return res.status(422).send({
      status: "error",
      message: "Invalid query parameters",
    });
  }

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
    return res.status(422).send({
      status: "error",
      message: "Invalid query parameters",
    });
  }

  if (minAgeNum != null) query = query.gte("age", minAgeNum);
  if (maxAgeNum != null) query = query.lte("age", maxAgeNum);
  if (minGenderProbNum != null)
    query = query.gte("gender_probability", minGenderProbNum);
  if (minCountryProbNum != null)
    query = query.gte("country_probability", minCountryProbNum);

  if (minAgeNum != null && maxAgeNum != null && minAgeNum > maxAgeNum) {
    return res.status(422).send({
      status: "error",
      message: "Invalid query parameters",
    });
  }
  let orderBool = null;
  // * SORTING
  if (sort_by) {
    const allowedSort = new Set(["age", "created_at", "gender_probability"]);
    if (!allowedSort.has(sort_by)) {
      return res.status(422).send({
        status: "error",
        message: "Invalid query parameters",
      });
    }

    if (order === undefined) {
      orderBool = true;
    } else if (order === "asc") {
      orderBool = true;
    } else if (order === "desc") {
      orderBool = false;
    } else {
      return res.status(422).send({
        status: "error",
        message: "Invalid query parameters",
      });
    }

    query = query.order(sort_by, {
      ascending: orderBool,
    });
  }

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
    return res.status(422).send({
      status: "error",
      message: "Invalid query parameters",
    });
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

export default profilesRouter;
