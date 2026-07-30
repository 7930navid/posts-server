const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const { Pool } = require("pg");
const types = require('pg').types;

types.setTypeParser(114, (val) => JSON.parse(val));
types.setTypeParser(3802, (val) => JSON.parse(val));

const app = express();
app.use(helmet());

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({
    extended: true,
    limit: "50mb"
}));

// 🔹 CORS Handling (Allowing Requests)
app.use(cors({
    origin: "*", // প্রয়োজনে নির্দিষ্ট Origin দিতে পারেন
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors()); // Preflight handling

// 🔹 Multi-DB URLs
const dbUrls = (process.env.DB_URLS || "").split(",").filter(Boolean);

// 🔹 Initialize Pools
const dbPools = dbUrls.map(
  url => new Pool({ 
    connectionString: url.trim(), 
    ssl: { rejectUnauthorized: false }, 
    max: 5, 
    idleTimeoutMillis: 30000 
  })
);

// 🔹 Deterministic DB selector (HASH based)
function hashToIndex(str) {
  let hash = 0;
  if (!str) return 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % dbPools.length;
}

function getUserPool(email) {
  if (!dbPools.length) throw new Error("No Database Connection Pools available!");
  return dbPools[hashToIndex(email || "default")];
}

// 🔹 Init DB tables on all pools
async function initDB() {
  for (const pool of dbPools) {
    try {
      await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

      // Posts Table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS posts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username TEXT NOT NULL,
          email TEXT NOT NULL,
          avatar TEXT NOT NULL,
          post JSONB NOT NULL,
          feelings TEXT,
          location TEXT,
          others JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 📌 Users Vibe Table (Added Auto-creation)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users_vibe (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) NOT NULL,
          username VARCHAR(100) NOT NULL,
          vibe TEXT,
          avatar TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log("✅ DB Tables ready on pool");
    } catch (err) {
      console.error("❌ DB init error:", err.message);
    }
  }
}

// 🔹 Keep-alive ping
async function pingAllPools() {
  for (const pool of dbPools) {
    try {
      await pool.query("SELECT 1");
      console.log(`[${new Date().toISOString()}] DB ping success`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] DB ping failed:`, err.message);
    }
  }
}
setInterval(pingAllPools, 1000 * 60 * 60 * 6);

// 🔹 Routes


/* =========================
   CHANGE ALL PROFILE INFO (Posts/Interacts/Story/Connection Server)
========================= */
app.put("/changeAllProf", async (req, res) => {
  try {
    const { email, username, bio, avatar, cover_photo } = req.body; 

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required" });
    }

    // ইমেইল দিয়ে সঠিক পুল বা ডাটাবেজ কানেকশন বের করা (আপনার প্রজেক্টের getUserPool ফাংশন অনুযায়ী)
    const pool = getUserPool(email);

    // ১. posts টেবিলে আপডেট
    const postUpdateResult = await pool.query(
      `
      UPDATE posts
      SET username = $1, avatar = $2
      WHERE email = $3
      RETURNING *
      `,
      [username, avatar, email]
    );

    // ২. users_vibe টেবিলে আপডেট
    const vibeUpdateResult = await pool.query(
      `
      UPDATE users_vibe
      SET username = $1, avatar = $2
      WHERE email = $3
      RETURNING *
      `,
      [username, avatar, email]
    );

    res.json({
      success: true,
      message: "Profile info updated successfully across both tables in this server",
      updatedPostsCount: postUpdateResult.rowCount,
      updatedVibeCount: vibeUpdateResult.rowCount
    });

  } catch (err) {
    console.error("Error updating profile in target server:", err.message);
    res.status(500).json({ success: false, message: "Server error while updating profile data" });
  }
});




app.get("/", (req, res) => res.json({ message: "Backend working ✅" }));

// 📌 ১. নতুন Vibe সেভ করার রুট (POST) - FIXED pool.query
app.post('/api/add-vibe', async (req, res) => {
    const { email, username, vibe, avatar } = req.body;

    try {
        // Email অনুযায়ী সঠিক Pool পছন্দ করা
        const pool = getUserPool(email);

        const query = `
            INSERT INTO users_vibe (email, username, vibe, avatar)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const result = await pool.query(query, [email || '', username || 'Anonymous', vibe || '', avatar || '']);
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error("Vibe Post Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 📌 ২. সব Vibe পাওয়ার রুট (GET) - FIXED Multi-DB fetch
app.get('/api/get-vibes', async (req, res) => {
    try {
        // সব DB থেকে Vibes ডাটা নিয়ে কম্বাইন করা
        const results = await Promise.all(
          dbPools.map((p) => p.query(`SELECT * FROM users_vibe ORDER BY created_at DESC;`))
        );
        const vibes = results
          .flatMap((r) => r.rows)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.status(200).json({ success: true, data: vibes });
    } catch (err) {
        console.error("Vibe Fetch Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* === 3. CREATE POST ROUTE === */
app.post("/post", async (req, res) => {
  try {
    const { user, post, avatar, feelings, location, others } = req.body;

    let parsedOthers = others;
    if (typeof others === "string") {
      try {
        parsedOthers = JSON.parse(others);
      } catch (e) {
        parsedOthers = [];
      }
    }

    const safeOthers = Array.isArray(parsedOthers)
      ? parsedOthers.map((o) => ({
          email: String(o?.email || ""),
          name: String(o?.name || ""),
          avatar: String(o?.avatar || ""),
        }))
      : [];

    const pool = getUserPool(user?.email);

    const result = await pool.query(
      `INSERT INTO posts
      (username, email, avatar, post, feelings, location, others)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING *`,
      [
        user?.username,
        user?.email,
        avatar,
        post,
        feelings || null,
        location || null,
        JSON.stringify(safeOthers)
      ]
    );

    res.json({
      message: "Post created successfully",
      post: result.rows[0],
    });

  } catch (err) {
    console.error("💥 DB INSERT ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
});

/* === 4. GET ALL POSTS ROUTE === */
app.get("/post", async (req, res) => {
  try {
    const results = await Promise.all(
      dbPools.map((p) => p.query("SELECT * FROM posts"))
    );

    const posts = results
      .flatMap((r) => r.rows)
      .map((post) => {
        let safeOthers = post.others;
        if (typeof safeOthers === "string") {
          try {
            safeOthers = JSON.parse(safeOthers);
          } catch (e) {
            safeOthers = [];
          }
        }
        return {
          ...post,
          others: Array.isArray(safeOthers) ? safeOthers : [],
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(posts);

  } catch (err) {
    console.error("💥 FETCH ERROR:", err.message);
    res.status(500).json({ message: "Error fetching posts" });
  }
});

// Get posts by user
app.get("/postOfAnUser/:email", async (req, res) => {
  try {
    const email = req.params.email;
    if (!email) return res.status(400).json({ message: "Email required" });
    const pool = getUserPool(email);
    const result = await pool.query("SELECT * FROM posts WHERE email=$1 ORDER BY created_at DESC", [email]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Error fetching user posts" });
  }
});

// Edit Post
app.put("/post/:email/:id", async (req, res) => {
  try {
    const { email, id } = req.params;
    const { post } = req.body;
    const pool = getUserPool(email);
    const result = await pool.query("UPDATE posts SET post=$1 WHERE id=$2 AND email=$3 RETURNING *", [post, id, email]);
    if (result.rowCount === 0) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Post updated", post: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
});

// Delete Post
app.delete("/post/:email/:id", async (req, res) => {
  try {
    const { email, id } = req.params;
    const pool = getUserPool(email);
    const result = await pool.query("DELETE FROM posts WHERE id=$1 AND email=$2", [id, email]);
    if (result.rowCount === 0) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Post deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

/* ============ PING ROUTE ==============*/
app.get("/get/:name", (req, res) => {
    res.send(`${req.params.name} server has been pinged`);
});

// 🔹 Start server
const PORT = process.env.PORT || 5000;
(async () => {
  await initDB();
  pingAllPools();
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
})();
