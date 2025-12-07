# Add posts table for user content
CREATE TABLE posts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	title TEXT NOT NULL,
	content TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

# Create index for faster queries
CREATE INDEX idx_posts_user_id ON posts(user_id);

-- migration: down
DROP INDEX idx_posts_user_id;
DROP TABLE posts;