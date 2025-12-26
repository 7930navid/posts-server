const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const { Pool } = require("pg");

const app = express();
app.use(helmet());
app.use(bodyParser.json());

app.use(
  cors({
    origin: ["https://7930navid.github.io", "http://localhost:8080"],
  })
);

// 🔹 Posts Database
const postsDB = new Pool({
  connectionString: process.env.POSTS_DB_URL,
  ssl: { rejectUnauthorized: false },
});

// 🔹 Init DB
async function initDB() {
  try {
    await postsDB.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        text TEXT NOT NULL,
        avatar TEXT NOT NULL
      );
    `);
    console.log("✅ Posts table ready");
  } catch (err) {
    console.error("❌ DB init error:", err.message);
  }
}

// 🔹 Create Post
app.post("/post", async (req, res) => {
  try {
    const { user, text, avatar } = req.body;

    if (!user || !user.username || !user.email) {
      return res.status(400).json({ message: "User info missing" });
    }

    if (!text) {
      return res.status(400).json({ message: "Please write a post first" });
    }

    await postsDB.query(
      "INSERT INTO posts (username, email, text, avatar) VALUES ($1,$2,$3,$4)",
      [user.username, user.email, text, avatar]
    );

    res.json({ message: "Post created successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// 🔹 Get All Posts
app.get("/post", async (req, res) => {
  try {
    const posts = await postsDB.query(
      "SELECT * FROM posts ORDER BY id DESC"
    );
    res.json(posts.rows);
  } catch (err) {
    res.status(500).json({ message: "Error fetching posts" });
  }
});

// 🔹 Edit Post
app.put("/post/:email/:id", async (req, res) => {
  try {
    const { email, id } = req.params;
    const { text } = req.body;

    const result = await postsDB.query(
      "UPDATE posts SET text=$1 WHERE id=$2 AND email=$3 RETURNING *",
      [text, id, email]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Unauthorized or not found" });
    }

    res.json({ message: "Post updated", post: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
});

// 🔹 Delete Post
app.delete("/post/:email/:id", async (req, res) => {
  try {
    const { email, id } = req.params;

    const result = await postsDB.query(
      "DELETE FROM posts WHERE id=$1 AND email=$2",
      [id, email]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Unauthorized or not found" });
    }

    res.json({ message: "Post deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

// 🔹 Edit All Posts of a User (username & avatar)
app.put("/edituserposts/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const { username, avatar } = req.body;

    if (!username || !avatar) {
      return res.status(400).json({ message: "Missing username or avatar" });
    }

    const result = await postsDB.query(
      "UPDATE posts SET username=$1, avatar=$2 WHERE email=$3 RETURNING *",
      [username, avatar, email]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "No posts found for this user" });
    }

    res.json({
      message: `All posts of ${email} updated`,
      updatedPosts: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update posts" });
  }
});

// 🔹 Delete All Posts of a User
app.delete("/deleteuserposts/:email", async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const result = await postsDB.query(
      "DELETE FROM posts WHERE email = $1",
      [email]
    );

    res.json({
      message: "All user posts deleted successfully",
      deletedCount: result.rowCount
    });

  } catch (err) {
    console.error("Error deleting user posts:", err.message);
    res.status(500).json({
      message: "Failed to delete user posts",
      error: err.message
    });
  }
});

// 🔹 Get posts by user email (for other profile)
app.get("/posts", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const result = await postsDB.query(
      `SELECT id, username, email, text, avatar
       FROM posts
       WHERE email = $1
       ORDER BY id DESC`,
      [email]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("Fetch user posts error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});



// 🔹 Health Check
app.get("/", (req, res) => {
  res.json({ message: "Backend working ✅" });
});

// 🔹 Start Server
const PORT = process.env.PORT || 5000;
(async () => {
  await initDB();
  app.listen(PORT, () =>
    console.log(`✅ Server running on port ${PORT}`)
  );
})();
