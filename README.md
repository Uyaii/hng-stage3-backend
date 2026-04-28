# Insighta Labs — Intelligence Query Engine

A demographic intelligence REST API built with **Node.js**, **Express**, and **Supabase (PostgreSQL)**. It supports advanced filtering, sorting, pagination, and natural language search over 2026 demographic profiles.

---

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** Supabase (PostgreSQL)
- **Language:** JavaScript (ESM)

---

## Getting Started

### Prerequisites

- Node.js v18+
- A Supabase project with the `profiles` table created

### Installation

```bash
git clone <your-repo-url>
cd <your-repo-folder>
npm install
```

### Environment Variables

Create a `.env` file in the root of your project:

```env
SUPABASE_PROJECT_URL=https://your-project-id.supabase.co
SUPABASE_API_KEY=your-anon-or-service-role-key
PORT=3000
```

### Database Schema

Your Supabase `profiles` table must follow this structure:

| Field               | Type             | Notes                          |
| ------------------- | ---------------- | ------------------------------ |
| id                  | UUID v7          | Primary key                    |
| name                | VARCHAR (UNIQUE) | Person's full name             |
| gender              | VARCHAR          | "male" or "female"             |
| gender_probability  | FLOAT            | Confidence score               |
| age                 | INT              | Exact age                      |
| age_group           | VARCHAR          | child, teenager, adult, senior |
| country_id          | VARCHAR(2)       | ISO code (NG, BJ, etc.)        |
| country_name        | VARCHAR          | Full country name              |
| country_probability | FLOAT            | Confidence score               |
| created_at          | TIMESTAMP        | Auto-generated                 |

### Seeding the Database

Place your `seed_profiles.json` file in the root directory. The file should follow this structure:

```json
{
  "profiles": [
    { "name": "Emmanuel", ... },
    ...
  ]
}
```

Then uncomment the `uploadProfiles()` call in `index.js` and run:

```bash
node index.js
```

Re-running the seed will **not** create duplicates — it uses an upsert with `onConflict: "name"`.

### Running the Server

```bash
node index.js
```

Server starts on `http://localhost:3000` by default.

---

## API Endpoints

### 1. `GET /api/profiles`

Returns a paginated, filtered, and sorted list of profiles.

**Supported Query Parameters:**

| Parameter               | Type    | Description                                          |
| ----------------------- | ------- | ---------------------------------------------------- |
| gender                  | string  | Filter by `male` or `female`                         |
| age_group               | string  | Filter by `child`, `teenager`, `adult`, or `senior`  |
| country_id              | string  | Filter by ISO country code (e.g. `NG`, `KE`)         |
| min_age                 | integer | Minimum age (inclusive)                              |
| max_age                 | integer | Maximum age (inclusive)                              |
| min_gender_probability  | float   | Minimum gender confidence score                      |
| min_country_probability | float   | Minimum country confidence score                     |
| sort_by                 | string  | Sort by `age`, `created_at`, or `gender_probability` |
| order                   | string  | Sort direction: `asc` or `desc` (default: `asc`)     |
| page                    | integer | Page number (default: `1`)                           |
| limit                   | integer | Results per page (default: `10`, max: `50`)          |

All filters are combinable. Results must match **every** condition passed.

**Example Request:**

```
GET /api/profiles?gender=male&country_id=NG&min_age=25&sort_by=age&order=desc&page=1&limit=10
```

**Success Response (200):**

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 312,
  "data": [
    {
      "id": "b3f9c1e2-7d4a-4c91-9c2a-1f0a8e5b6d12",
      "name": "emmanuel",
      "gender": "male",
      "gender_probability": 0.99,
      "age": 34,
      "age_group": "adult",
      "country_id": "NG",
      "country_name": "Nigeria",
      "country_probability": 0.85,
      "created_at": "2026-04-01T12:00:00Z"
    }
  ]
}
```

---

### 2. `GET /api/profiles/search`

Accepts a plain English query string and converts it into database filters.

**Query Parameters:**

| Parameter | Description                                  |
| --------- | -------------------------------------------- |
| q         | The natural language search query (required) |
| page      | Page number (default: `1`)                   |
| limit     | Results per page (default: `10`, max: `50`)  |

**Example Request:**

```
GET /api/profiles/search?q=young males from nigeria&page=1&limit=10
```

**Success Response (200):**

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 45,
  "data": [...]
}
```

**Uninterpretable Query Response:**

```json
{
  "status": "error",
  "message": "Unable to interpret query"
}
```

---

## Natural Language Parsing Approach

The search endpoint uses **rule-based keyword parsing only** — no AI or LLMs are involved.

### How It Works

1. The raw query string is lowercased and sanitized (special characters removed)
2. The sanitized text is checked against a set of known keywords using `.includes()` and regular expressions
3. Matched keywords are converted into filter values and applied to the Supabase query
4. If no filters could be extracted, an error is returned

---

### Supported Keywords and Their Mappings

#### Gender

| Keyword(s)                                 | Maps To             |
| ------------------------------------------ | ------------------- |
| male, males, man, men, boy, boys           | `gender = "male"`   |
| female, females, woman, women, girl, girls | `gender = "female"` |

> If **both** male and female keywords appear in the query, gender is **not filtered** (e.g. "male and female teenagers").

---

#### Age Group

| Keyword(s)                       | Maps To                  |
| -------------------------------- | ------------------------ |
| child, children                  | `age_group = "child"`    |
| teenager, teenagers, teen, teens | `age_group = "teenager"` |
| adult, adults                    | `age_group = "adult"`    |
| senior, seniors, elderly         | `age_group = "senior"`   |

---

#### Age Range

| Pattern                                       | Maps To                                                           |
| --------------------------------------------- | ----------------------------------------------------------------- |
| young                                         | `min_age = 16`, `max_age = 24` (parsing only, not a stored group) |
| above N, over N, older than N, at least N, N+ | `min_age = N`                                                     |
| below N, under N, younger than N, at most N   | `max_age = N`                                                     |
| between N and M                               | `min_age = min(N,M)`, `max_age = max(N,M)`                        |
| age N-M, aged N to M                          | `min_age = min(N,M)`, `max_age = max(N,M)`                        |

> Multiple age constraints are **intersected** — the tightest range wins.

---

#### Country

The parser looks for the keywords `from` or `in` followed by a country name or ISO code.

- Country names are matched using the `country-list` npm package (full list of countries)
- Common aliases are also supported:

| Alias                                                  | Maps To |
| ------------------------------------------------------ | ------- |
| usa, us, u.s., united states, united states of america | `US`    |
| uk, u.k., united kingdom                               | `GB`    |

**Examples:**

```
"from nigeria"         →  country_id = "NG"
"in kenya"             →  country_id = "KE"
"from angola"          →  country_id = "AO"
"from us"              →  country_id = "US"
```

---

### Full Query Mapping Examples

| Query                              | Parsed Filters                                       |
| ---------------------------------- | ---------------------------------------------------- |
| young males                        | gender=male, min_age=16, max_age=24                  |
| females above 30                   | gender=female, min_age=30                            |
| people from angola                 | country_id=AO                                        |
| adult males from kenya             | gender=male, age_group=adult, country_id=KE          |
| male and female teenagers above 17 | age_group=teenager, min_age=17                       |
| senior women in nigeria            | gender=female, age_group=senior, country_id=NG       |
| young girls from ghana             | gender=female, min_age=16, max_age=24, country_id=GH |

---

## Limitations and Known Edge Cases

### Parser Limitations

- **No semantic understanding** — the parser only matches exact keywords. Synonyms like "guys", "ladies", "old people", or "youngsters" are not recognized.
- **Single age group per query** — if multiple age group keywords appear (e.g. "adults and seniors"), only the last matched one is applied.
- **Country must follow "from" or "in"** — queries like "nigerian males" or "kenyan adults" are not parsed for country.
- **Multi-word country names may fail** — if stop words interrupt the country name (e.g. "people from the republic of congo"), parsing may not extract the full name correctly.
- **No spelling correction** — typos like "femal" or "nigria" will not be matched.
- **No negation support** — queries like "not from nigeria" or "everyone except adults" are not handled.
- **"Young" conflicts with age ranges** — if both "young" and an explicit age range (e.g. "above 30") are present, the ranges are intersected which may produce an impossible range and return an error.
- **Only one country per query** — the parser stops at the first recognized country after "from" or "in".

### General Limitations

- All stored names are lowercase. Queries using the `name` field in `/api/profiles` are normalized to lowercase before matching.
- The `limit` parameter is capped at 50 regardless of what value is passed.
- Probability filters (`min_gender_probability`, `min_country_probability`) only apply on the `/api/profiles` endpoint, not on the natural language search endpoint.

---

## Error Responses

All errors follow this structure:

```json
{
  "status": "error",
  "message": "<error message>"
}
```

| Status Code | Meaning                                         |
| ----------- | ----------------------------------------------- |
| 400         | Missing or empty required parameter             |
| 422         | Invalid parameter type or uninterpretable query |
| 404         | Profile not found                               |
| 500         | Server or database failure                      |

---

## CORS

All responses include the header:

```
Access-Control-Allow-Origin: *
```
# hng-stage2-backend
# hng-stage3-backend
# hng-stage3-backend
