// export const upsertDB = async (dbUser || hashedToken) => {
//     const { data, error } = await supabase
//       .from("tokens")
//       .upsert(
//         {
//           id: uuidv7(),
//           user_id: dbUser.id,
//           token_hash: hashedToken,
//           expires_at: new Date(Date.now() + 5 * 60 * 1000),
//           created_at: new Date(),
//         },
//         { onConflict: "user_id" },
//       )
//       .select();

// };
