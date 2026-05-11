const roleMiddleware = (role) => {
  return (req, res, next) => {
    if (req.user.role !== role)
      return res.status(403).send({
        status: "error",
        message: "Role Mismatch / Permission Denied",
      });

    // res.send({
    //   status: "success",
    //   message: "Access Granted",
    // }); -> This isnt needed but im not sure why
    next();
  };
};

export default roleMiddleware