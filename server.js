const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcrypt");


const { Pool } = require("pg");

const app = express();
app.use(helmet());
app.use(bodyParser.json());

app.use(
  cors({
    origin: ["https://7930navid.github.io", "http://localhost:8080"],
  })
);


// 🔹 Post-DB connections

const postsDB = new Pool({
  connectionString: process.env.POSTS_DB_URL,
  ssl: { rejectUnauthorized: false },
});


// 🔹 Initialize tables
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


    console.log("✅ Post table initialized successfully!");
  } catch (err) {
    console.error("❌ Error initializing table:", err.message);
  }
}



// 🔹 Create Post  
app.post("/post", async (req, res) => {
  try {
    const { user, text, avatar } = req.body;
    if (!text) return res.status(400).json({ message: "Please write a post firs>

    await postsDB.query(
      "INSERT INTO posts (username, email, text, avatar) VALUES ($1, $2, $3, $4>
      [u.rows[0].username, u.rows[0].email, text, avatar]
    );

    res.json({ message: "Post Created" });                                      
  } catch (err) {
    res.status(500).json({ message: "Error creating post", error: err.message }>
  }
});

// 🔹 Get all posts
app.get("/post", async (req, res) => {
  try {
    const posts = await postsDB.query("SELECT * FROM posts ORDER BY id DESC");
    res.json(posts.rows);
  } catch (err) {
    res.status(500).json({ message: "Error fetching posts", error: err.message });
  }
});

// 🔹 Edit Post by ID + Email
app.put("/post/:email/:id", async (req, res) => {
  try {
    const { email, id } = req.params;
    const { text } = req.body;

    const result = await postsDB.query(
      "UPDATE posts SET text=$1 WHERE id=$2 AND email=$3 RETURNING *",
      [text, id, email]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ message: "Post not found or unauthorized" });

    res.json({ message: "Post updated successfully", post: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Error updating post", error: err.message });
  }
});

// 🔹 Delete Post
app.delete("/post/:email/:id", async (req, res) => {
  try {
    const { email, id } = req.params;

    const result = await postsDB.query("DELETE FROM posts WHERE id=$1 AND email=$2", [id, email]);

    if (result.rowCount > 0) {
      res.json({ message: "Post deleted successfully" });
    } else {
      res.status(404).json({ message: "Post not found or unauthorized" });
    }

  } catch (err) {
    res.status(500).json({ message: "Error deleting post", error: err.message });
  }
});


// 🔹 Delete User + Posts
app.delete("/deleteuser/:email", async (req, res) => {
  try {
    const { email } = req.params;
    await postsDB.query("DELETE FROM posts WHERE email=$1", [email]);

    if (result.rowCount > 0)
      res.json({ message: `All posts of ${email} has been deleted` });
    else
      res.status(404).json({ message: "User not found" });
  } catch (err) {}
});


// 🔐 Verify password (for sensitive actions)
app.post("/verify-password", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Missing data" });
    }

    const result = await usersDB.query(
      "SELECT password FROM users WHERE email=$1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const hashedPassword = result.rows[0].password;
    const isValid = await bcrypt.compare(password, hashedPassword);

    if (!isValid) {
      return res.status(401).json({ message: "Wrong password" });
    }

    res.json({ message: "Password verified" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// 🔹 Server check
app.get("/", (req, res) => res.json({ message: "Backend is working ✅" }));

// 🔹 Start Server
const PORT = process.env.PORT || 5000;
async function startServer() {
  await initDB();
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}
startServer();
