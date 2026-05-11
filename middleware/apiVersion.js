const apiVersionMiddleware = (req, res, next) => {
  const reqVersion = req.headers["x-api-version"];
  if (reqVersion !== "1")
    return res.status(400).send({
      status: "error",
      message: "API version header required",
    });
  next();
};

export default apiVersionMiddleware;
