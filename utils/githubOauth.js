import axios from "axios";

export const tokenExchange = async (code) => {
  // const params = new URLSearchParams({
  //   client_id: process.env.CLIENT_ID,
  //   client_secret: process.env.CLIENT_SECRET,
  //   code: code,
  // }); /// not like this
  const response = await axios.post(
    "https://github.com/login/oauth/access_token",
    {
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      code: code,
    },
    {
      headers: { Accept: "application/json" },
    },
  );
  const githubAccessCode = response.data.access_token;
  const user = await axios.get("https://api.github.com/user", {
    // Authorization: `Bearer ${githubAccessCode}`,
    // Accept: "application/json", This is wrong!!!!
    headers: {
      Authorization: `Bearer ${githubAccessCode}`,
      Accept: "application/json",
    },
  });
  return user;
};
