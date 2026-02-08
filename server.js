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

// 🔹 Multi-DB URLs (10 DBs)
const dbUrls = [
  "postgresql://neondb_owner:npg_BVZsnRw47Xev@ep-icy-night-aigqp1l0-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  "postgresql://neondb_owner:npg_3NMUSF0vnwoB@ep-misty-sound-ai84wk63-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  "postgresql://neondb_owner:npg_qncA1oPLrBi2@ep-solitary-smoke-aiyildjx-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  "postgresql://neondb_owner:npg_EPkLtjuG21Yy@ep-quiet-bread-ai16qo25-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  "postgresql://neondb_owner:npg_xwuZ0lAjUX7v@ep-falling-frost-aiuxn4rr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  "postgresql://neondb_owner:npg_COFxG0zQuTP9@ep-sparkling-waterfall-ais3zih3-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  "postgresql://neondb_owner:npg_Oq51cRZApJHf@ep-dry-mud-aipu6fg7-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  "postgresql://neondb_owner:npg_oc5SFmyLR2JI@ep-empty-dust-ai3bn45u-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  "postgresql://neondb_owner:npg_oGbQTHuFkV21@ep-round-bird-aijs4ixk-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  "postgresql://neondb_owner:npg_7rwnXpzCL0Ff@ep-steep-bonus-ai86o1rr-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
];

// 🔹 Initialize Pools
const dbPools = dbUrls.map(
  url => new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 30000 })
);

// 🔹 Deterministic DB selector (HASH based)
function hashToIndex(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % dbPools.length;
}

function getUserPool(email) {
  return dbPools[hashToIndex(email)];
}

// 🔹 Init DB tables on all pools with UUID
async function initDB() {
  for (const pool of dbPools) {
    try {
      // Enable pgcrypto for UUID
      await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS posts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username TEXT NOT NULL,
          email TEXT NOT NULL,
          avatar TEXT NOT NULL,
          post JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log("✅ Posts table ready on pool", pool.options.connectionString.slice(0,30) + "...");
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
pingAllPools();

// 🔹 Routes

app.get("/", (req,res)=>res.json({message:"Backend working ✅"}));

// Create Post
app.post("/post", async (req,res)=>{
  try{
    const { user, post, avatar } = req.body;
    if(!user?.email || !user?.username || !post?.text) return res.status(400).json({message:"Invalid data"});

    const pool = getUserPool(user.email);
    const result = await pool.query(
      `INSERT INTO posts (username,email,avatar,post) VALUES($1,$2,$3,$4) RETURNING *`,
      [user.username,user.email,avatar,post]
    );

    res.json({message:"Post created", post: result.rows[0]});
  }catch(err){
    console.error(err);
    res.status(500).json({message:"Server error"});
  }
});

// Get all posts
app.get("/post", async (req,res)=>{
  try{
    const results = await Promise.all(dbPools.map(p=>p.query("SELECT * FROM posts")));
    const posts = results.flatMap(r=>r.rows).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    res.json(posts);
  }catch(err){
    console.error(err);
    res.status(500).json({message:"Error fetching posts"});
  }
});

// Get posts by user
app.get("/posts", async (req,res)=>{
  try{
    const { email } = req.query;
    if(!email) return res.status(400).json({message:"Email required"});
    const pool = getUserPool(email);
    const result = await pool.query("SELECT * FROM posts WHERE email=$1 ORDER BY created_at DESC",[email]);
    res.json(result.rows);
  }catch(err){
    console.error(err);
    res.status(500).json({message:"Error fetching user posts"});
  }
});

// Edit Post
app.put("/post/:email/:id", async (req,res)=>{
  try{
    const { email,id } = req.params;
    const { post } = req.body;
    const pool = getUserPool(email);
    const result = await pool.query("UPDATE posts SET post=$1 WHERE id=$2 AND email=$3 RETURNING *",[post,id,email]);
    if(result.rowCount===0) return res.status(404).json({message:"Not found"});
    res.json({message:"Post updated", post: result.rows[0]});
  }catch(err){
    console.error(err);
    res.status(500).json({message:"Update failed"});
  }
});

// Delete Post
app.delete("/post/:email/:id", async (req,res)=>{
  try{
    const { email,id } = req.params;
    const pool = getUserPool(email);
    const result = await pool.query("DELETE FROM posts WHERE id=$1 AND email=$2",[id,email]);
    if(result.rowCount===0) return res.status(404).json({message:"Not found"});
    res.json({message:"Post deleted"});
  }catch(err){
    console.error(err);
    res.status(500).json({message:"Delete failed"});
  }
});

// Update all posts of a user
app.put("/edituserposts/:email", async (req,res)=>{
  try{
    const { email } = req.params;
    const { username,avatar } = req.body;
    if(!username || !avatar) return res.status(400).json({message:"Missing data"});
    const pool = getUserPool(email);
    const result = await pool.query("UPDATE posts SET username=$1, avatar=$2 WHERE email=$3 RETURNING *",[username,avatar,email]);
    if(result.rowCount===0) return res.status(404).json({message:"No posts found"});
    res.json({message:`All posts of ${email} updated`, updatedPosts: result.rows});
  }catch(err){
    console.error(err);
    res.status(500).json({message:"Failed to update posts"});
  }
});

// Delete all posts of a user
app.delete("/deleteuserposts/:email", async (req,res)=>{
  try{
    const { email } = req.params;
    if(!email) return res.status(400).json({message:"Email required"});
    const pool = getUserPool(email);
    const result = await pool.query("DELETE FROM posts WHERE email=$1",[email]);
    res.json({message:"All user posts deleted", deletedCount: result.rowCount});
  }catch(err){
    console.error(err);
    res.status(500).json({message:"Failed to delete user posts"});
  }
});

// 🔹 Start server
const PORT = process.env.PORT||5000;
(async()=>{
  await initDB();
  app.listen(PORT,()=>console.log(`✅ Server running on port ${PORT}`));
})();